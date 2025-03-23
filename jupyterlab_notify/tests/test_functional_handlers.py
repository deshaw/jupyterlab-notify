import json
from unittest.mock import MagicMock
from tornado.web import Application
from tornado.testing import AsyncHTTPTestCase
from jupyter_server.auth import IdentityProvider
from jupyterlab_notify import handlers
from jupyter_server.base.handlers import JupyterHandler


def disable_xsrf(self):
    pass


JupyterHandler.check_xsrf_cookie = disable_xsrf  # Disable CSRF globally in tests


class DummyIdentityProvider(IdentityProvider):
    """A minimal identity provider that returns a dummy user."""

    async def get_user(self, handler):
        return {"name": "test-user"}  # Mock user details


class DummyConfig:  # Mock config
    def __init__(self):
        self.smtp_instance = True


class DummyExtensionApp:
    def __init__(self):
        self.is_listening = True
        self.email = "test@example.com"
        self.slack_client = MagicMock()
        self.slack_user_id = "U12345678"
        self.slack_channel_name = "general"
        self.cell_ids = {}
        self._config = DummyConfig()

    def send_notification(self, params):
        self.notification_sent = True


class TestNotifyHandler(AsyncHTTPTestCase):
    def get_app(self):
        self.dummy_app = DummyExtensionApp()
        settings = {
            "identity_provider": DummyIdentityProvider(),
        }
        return Application(
            [
                (
                    r"/api/jupyter-notify/notify",
                    handlers.NotifyHandler,
                    {"extension_app": self.dummy_app, "name": "test"},
                ),
            ],
            **settings,
        )

    def test_get(self):
        response = self.fetch("/api/jupyter-notify/notify", method="GET")
        self.assertEqual(response.code, 200)
        data = json.loads(response.body)
        self.assertTrue(data.get("nbmodel_installed"))
        self.assertTrue(data.get("slack_configured"))
        self.assertTrue(data.get("email_configured"))

    def test_post_valid(self):
        payload = {
            "cell_id": "cell42",
            "mode": "always",
            "slackEnabled": True,
            "emailEnabled": True,
            "successMessage": "Done",
            "failureMessage": "Error",
            "threshold": 1,
        }
        response = self.fetch(
            "/api/jupyter-notify/notify", method="POST", body=json.dumps(payload)
        )
        self.assertEqual(response.code, 200)
        data = json.loads(response.body)
        self.assertTrue(data.get("accepted"))
        self.assertIn("cell42", self.dummy_app.cell_ids)


class TestNotifyTriggerHandler(AsyncHTTPTestCase):
    def get_app(self):
        self.dummy_app = DummyExtensionApp()
        settings = {
            "identity_provider": DummyIdentityProvider(),  # Suppress identity provider warnings
        }
        return Application(
            [
                (
                    r"/api/jupyter-notify/notify-trigger",
                    handlers.NotifyTriggerHandler,
                    {"extension_app": self.dummy_app, "name": "test"},
                ),
            ],
            **settings,
        )

    def test_post_trigger(self):
        payload = {
            "cell_id": "cell99",
            "mode": "always",
            "slackEnabled": True,
            "emailEnabled": True,
            "successMessage": "Ok",
            "failureMessage": "Not Ok",
            "threshold": 1,
        }
        response = self.fetch(
            "/api/jupyter-notify/notify-trigger",
            method="POST",
            body=json.dumps(payload),
        )
        self.assertEqual(response.code, 200)
        data = json.loads(response.body)
        self.assertTrue(data.get("done"))
        self.assertTrue(
            hasattr(self.dummy_app, "notification_sent")
            and self.dummy_app.notification_sent
        )
