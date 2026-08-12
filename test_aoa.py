"""AOA 中间件单元测试（零第三方依赖，仅标准库）。"""
import os
import sys
import time
import unittest

ROOT = os.path.dirname(os.path.abspath(__file__))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from aoa import CircuitBreaker, CallCache, CostBudget, wrap_http, CircuitOpenError


def fake_get(url, **kw):
    fake_get.calls += 1
    return {"url": url, "kw": kw, "ok": True}


fake_get.calls = 0


class TestCircuitBreaker(unittest.TestCase):
    def test_allow_when_closed(self):
        b = CircuitBreaker(failure_threshold=3, reset_timeout=0.05)
        self.assertTrue(b.allow())

    def test_open_after_threshold(self):
        b = CircuitBreaker(failure_threshold=3, reset_timeout=0.05)
        for _ in range(3):
            b.on_failure()
        self.assertFalse(b.allow())

    def test_half_open_recovers(self):
        b = CircuitBreaker(failure_threshold=2, reset_timeout=0.05)
        for _ in range(2):
            b.on_failure()
        self.assertFalse(b.allow())
        time.sleep(0.1)
        self.assertTrue(b.allow())
        b.on_success()
        self.assertTrue(b.allow())

    def test_success_resets(self):
        b = CircuitBreaker(failure_threshold=2, reset_timeout=10)
        b.on_failure(); b.on_failure()
        self.assertFalse(b.allow())
        b.on_success()
        self.assertTrue(b.allow())


class TestCallCache(unittest.TestCase):
    def test_put_get(self):
        c = CallCache(ttl=100)
        c.put("k", {"v": 1})
        self.assertEqual(c.get("k"), {"v": 1})

    def test_miss(self):
        c = CallCache(ttl=100)
        self.assertIsNone(c.get("x"))

    def test_expiry(self):
        c = CallCache(ttl=0.05)
        c.put("k", 1)
        self.assertEqual(c.get("k"), 1)
        time.sleep(0.1)
        self.assertIsNone(c.get("k"))


class TestCostBudget(unittest.TestCase):
    def test_charge(self):
        b = CostBudget(max_tokens=100)
        b.charge(30)
        self.assertEqual(b.used, 30)
        self.assertEqual(b.remaining(), 70)
        self.assertTrue(b.can_spend(70))
        self.assertFalse(b.can_spend(71))

    def test_exceeded(self):
        b = CostBudget(max_tokens=10)
        b.charge(10)
        self.assertFalse(b.can_spend(1))


class TestWrapHTTP(unittest.TestCase):
    def setUp(self):
        fake_get.calls = 0

    def test_success(self):
        breaker = CircuitBreaker(failure_threshold=2, reset_timeout=1)
        resp = wrap_http("t", fake_get, breaker, "http://u", timeout=5)
        self.assertEqual(resp["url"], "http://u")
        self.assertEqual(resp["kw"].get("timeout"), 5)
        self.assertEqual(fake_get.calls, 1)

    def test_failure_records_breaker(self):
        def boom(url, **kw):
            raise RuntimeError("boom")
        breaker = CircuitBreaker(failure_threshold=1, reset_timeout=1)
        with self.assertRaises(RuntimeError):
            wrap_http("t", boom, breaker, "http://u")
        self.assertFalse(breaker.allow())

    def test_open_skips_call(self):
        breaker = CircuitBreaker(failure_threshold=1, reset_timeout=100)
        breaker.on_failure()  # 置 OPEN
        with self.assertRaises(CircuitOpenError):
            wrap_http("t", fake_get, breaker, "http://u")
        self.assertEqual(fake_get.calls, 0)


if __name__ == "__main__":
    unittest.main()
