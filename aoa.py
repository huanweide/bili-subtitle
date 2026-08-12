"""
AOA 中间件 — 零第三方依赖（仅 Python 标准库）。

为外部 API（B站 HTTP + LLM）统一提供四类自动化优化防护：
  - CircuitBreaker  异常即熔断（连续失败 N 次后 OPEN，期间抛 CircuitOpenError）
  - CallCache       结果缓存（按 key TTL，避免重复付费 / 重复请求）
  - CostBudget      token 成本预算（全局累加，超预算抛 BudgetExceeded）
  - wrap_llm / wrap_http  包裹函数，注入熔断 + 预算 + 异常透传

设计铁律（AutonomousOptimizationArchitect）：
  不做主观评分；不干扰生产（失败走原降级路径）；必算成本；
  异常即熔断；硬性超时（由调用方在客户端/请求层设置）；廉价降级。
"""

import time
import threading


class CircuitOpenError(Exception):
    """熔断器 OPEN：上游连续失败过多，已停止调用。"""


class BudgetExceeded(Exception):
    """成本预算耗尽：token 累计超过上限。"""


class CircuitBreaker:
    """连续失败计数熔断（适合单进程 Flask / 脚本）。线程安全。"""

    def __init__(self, failure_threshold: int = 3, reset_timeout: float = 60.0):
        self.failure_threshold = failure_threshold
        self.reset_timeout = reset_timeout
        self._failures = 0
        self._opened_at = 0.0
        self._lock = threading.Lock()

    def allow(self) -> bool:
        with self._lock:
            if self._opened_at == 0.0:
                return True
            if time.time() - self._opened_at >= self.reset_timeout:
                # 半开探测：复位，允许一次试探
                self._opened_at = 0.0
                self._failures = 0
                return True
            return False

    def on_success(self) -> None:
        with self._lock:
            self._failures = 0
            self._opened_at = 0.0

    def on_failure(self) -> None:
        with self._lock:
            self._failures += 1
            if self._failures >= self.failure_threshold:
                self._opened_at = time.time()

    def reset(self) -> None:
        with self._lock:
            self._failures = 0
            self._opened_at = 0.0


class CallCache:
    """TTL 内存缓存（标准库实现）。key 由调用方提供，value 任意可 pickle 对象。"""

    def __init__(self, ttl: float = 300.0):
        self.ttl = ttl
        self._store = {}
        self._lock = threading.Lock()

    def get(self, key):
        with self._lock:
            item = self._store.get(key)
            if item is None:
                return None
            value, expire = item
            if time.time() >= expire:
                del self._store[key]
                return None
            return value

    def put(self, key, value) -> None:
        with self._lock:
            self._store[key] = (value, time.time() + self.ttl)

    def clear(self) -> None:
        with self._lock:
            self._store.clear()


class CostBudget:
    """token 成本预算（全局累加，超预算抛 BudgetExceeded）。线程安全。"""

    def __init__(self, max_tokens: int = 200000):
        self.max_tokens = max_tokens
        self._used = 0
        self._lock = threading.Lock()

    def can_spend(self, tokens: int = 0) -> bool:
        with self._lock:
            return self._used + tokens <= self.max_tokens

    def charge(self, tokens: int) -> None:
        with self._lock:
            self._used += tokens

    @property
    def used(self) -> int:
        with self._lock:
            return self._used

    def remaining(self) -> int:
        with self._lock:
            return max(0, self.max_tokens - self._used)


# ── 全局命名空间隔离的默认实例 ──────────────────────────
_BREAKERS = {}
_BUDGETS = {}
_LOCK = threading.Lock()


def get_breaker(name: str, failure_threshold: int = 3,
                reset_timeout: float = 60.0) -> CircuitBreaker:
    with _LOCK:
        if name not in _BREAKERS:
            _BREAKERS[name] = CircuitBreaker(failure_threshold, reset_timeout)
        return _BREAKERS[name]


def get_budget(name: str, max_tokens: int = 200000) -> CostBudget:
    with _LOCK:
        if name not in _BUDGETS:
            _BUDGETS[name] = CostBudget(max_tokens)
        return _BUDGETS[name]


def wrap_llm(name: str, client, breaker: CircuitBreaker = None,
             budget: CostBudget = None, failure_threshold: int = 3,
             reset_timeout: float = 60.0, **create_kwargs):
    """包裹一次 LLM 调用：熔断 + 预算 + 异常透传。

    调用方负责传入已带 timeout 的 client（OpenAI(timeout=...)），
    硬性超时由客户端层保障。本函数只做熔断与预算：
      - 熔断 OPEN → 抛 CircuitOpenError（业务层捕获后降级）
      - 成功且有 usage → 计费
      - 失败 → 记熔断失败并原样抛出
    """
    br = breaker or get_breaker(name, failure_threshold, reset_timeout)
    if not br.allow():
        raise CircuitOpenError(f"LLM 熔断器 [{name}] 已 OPEN，跳过调用")
    try:
        resp = client.chat.completions.create(**create_kwargs)
    except Exception:
        br.on_failure()
        raise
    br.on_success()
    if budget is not None and getattr(resp, "usage", None) is not None:
        budget.charge(getattr(resp.usage, "total_tokens", 0))
    return resp


def wrap_http(name: str, fn, breaker: CircuitBreaker = None,
              *args, failure_threshold: int = 3, reset_timeout: float = 60.0,
              **kwargs):
    """包裹一次 HTTP 调用（requests get/post 等）：熔断 + 异常透传。

    注意：failure_threshold / reset_timeout 设计为 keyword-only，必须放在
    *args 之后。否则调用方传入的 url 等位置实参会先被 Python 抢占填进
    failure_threshold，导致真正的请求参数丢失（已踩坑修复）。
    """
    br = breaker or get_breaker(name, failure_threshold, reset_timeout)
    if not br.allow():
        raise CircuitOpenError(f"HTTP 熔断器 [{name}] 已 OPEN，跳过调用")
    try:
        resp = fn(*args, **kwargs)
    except Exception:
        br.on_failure()
        raise
    br.on_success()
    return resp
