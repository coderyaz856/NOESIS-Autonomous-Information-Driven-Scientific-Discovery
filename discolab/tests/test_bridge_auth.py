"""The bridge authenticates every request when a token is configured, and refuses unsafe startups."""

import http.client
import json
import threading
from http.server import ThreadingHTTPServer

import pytest

from discolab import bridge

TOKEN = "t" * 40


@pytest.fixture
def server(monkeypatch):
    monkeypatch.setattr(bridge, "BRIDGE_TOKEN", TOKEN)
    monkeypatch.setattr(bridge, "ENABLE_RUNS", True)
    started = []
    monkeypatch.setattr(bridge, "start_run", lambda body, client=None: started.append(body) or (201, {"ok": True}))
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), bridge.Handler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    yield httpd.server_address[1], started
    httpd.shutdown()
    httpd.server_close()


def call(port, method, path, token=None, body=None):
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
    headers = {"Content-Type": "application/json"}
    if token is not None:
        headers[bridge.TOKEN_HEADER] = token
    conn.request(method, path, body=json.dumps(body) if body is not None else None, headers=headers)
    res = conn.getresponse()
    data = res.read()
    conn.close()
    return res.status, json.loads(data or b"{}")


@pytest.mark.parametrize("path", ["/lab/sources", "/lab/capabilities", "/lab/state?source=results/escalation",
                                  "/lab/stream?source=results/escalation", "/lab/unknown"])
@pytest.mark.parametrize("token", [None, "", "wrong", TOKEN[:-1], TOKEN + "x"])
def test_every_read_needs_the_exact_token(server, path, token):
    port, _ = server
    status, body = call(port, "GET", path, token)
    assert status == 401
    assert body["error"]["code"] == "unauthorized"


@pytest.mark.parametrize("token", [None, "wrong"])
def test_writes_are_refused_before_any_work(server, token):
    port, started = server
    status, _ = call(port, "POST", "/lab/runs", token, {"question": "Does entropy predict stagnation onset?"})
    assert status == 401
    assert started == []


def test_the_right_token_is_served(server):
    port, started = server
    assert call(port, "GET", "/lab/capabilities", TOKEN)[0] == 200
    status, body = call(port, "POST", "/lab/runs", TOKEN, {"question": "Does entropy predict stagnation onset?"})
    assert (status, body) == (201, {"ok": True})
    assert len(started) == 1


def test_without_a_token_the_bridge_stays_open_for_local_development():
    assert bridge.authorized({}, None)


def test_token_loading(tmp_path):
    assert bridge.load_bridge_token({}) is None
    assert bridge.load_bridge_token({"NOESIS_BRIDGE_TOKEN": "  " + TOKEN + "\n"}) == TOKEN
    f = tmp_path / "bridge_token"
    f.write_text(TOKEN + "\n", encoding="utf-8")
    assert bridge.load_bridge_token({"NOESIS_BRIDGE_TOKEN_FILE": str(f), "NOESIS_BRIDGE_TOKEN": "x" * 40}) == TOKEN
    with pytest.raises(bridge.BridgeAuthError, match="at least 32"):
        bridge.load_bridge_token({"NOESIS_BRIDGE_TOKEN": "short"})
    with pytest.raises(bridge.BridgeAuthError, match="cannot read"):
        bridge.load_bridge_token({"NOESIS_BRIDGE_TOKEN_FILE": str(tmp_path / "missing")})


def test_agent_processes_never_inherit_noesis_server_settings():
    from discolab.muse import agent_base_env
    env = agent_base_env({"NOESIS_BRIDGE_TOKEN": TOKEN, "NOESIS_BRIDGE_TOKEN_FILE": "/etc/noesis/bridge_token",
                          "NOESIS_LAB_WRITE_TOKEN": "operator-secret", "noesis_future_secret": "future-secret",
                          "NOESIS_TRIAL_TOTAL_USD": "20",
                          "MODEL_API_KEY_FILE": "/etc/noesis/meta_api_key", "PATH": "/usr/bin"})
    assert env == {"MODEL_API_KEY_FILE": "/etc/noesis/meta_api_key", "PATH": "/usr/bin"}


def test_unsafe_startups_are_refused():
    bridge.check_startup("127.0.0.1", None, require_auth=False)
    bridge.check_startup("0.0.0.0", TOKEN, require_auth=True)
    with pytest.raises(bridge.BridgeAuthError, match="require-auth"):
        bridge.check_startup("127.0.0.1", None, require_auth=True)
    with pytest.raises(bridge.BridgeAuthError, match="without a bridge token"):
        bridge.check_startup("0.0.0.0", None, require_auth=False)
