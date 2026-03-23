import pytest
from unittest.mock import MagicMock
from jupyterlab_notify import extension
from jupyterlab_notify.config import NotificationParams
from traitlets.config import Config


@pytest.fixture
def dummy_config():
    # Create dummy config
    config_data = {
        "NotificationConfig": {
            "email": "test@example.com",
            "slack_token": "xoxb-dummy-slack-token",
            "slack_user_id": "U12345678",
            "slack_channel_name": "general",
        }
    }
    return Config(config_data)  # Convert dict to Config


@pytest.fixture
def notify_extension(dummy_config):
    ext = extension.NotifyExtension()
    ext.update_config(dummy_config)
    ext._init_config()

    dummy_smtp = MagicMock()
    dummy_smtp.send_message = MagicMock()
    ext._config.smtp_instance = dummy_smtp

    dummy_slack_client = MagicMock()
    dummy_slack_client.conversations_open.return_value = {
        "channel": {"id": "D12345678"}
    }
    ext.slack_client = dummy_slack_client
    ext.slack_imported = True
    return ext


def test_end_to_end_notification(notify_extension):
    """
    Integration test that calls send_notification and checks that both
    slack and email notifications are dispatched end-to-end.
    """
    params = NotificationParams(
        cell_id="cell_integration",
        mode="default",
        slackEnabled=True,
        emailEnabled=True,
        successMessage="Integration Success",
        failureMessage="Integration Failure",
        threshold=5,
        success=True,
        start_time="2025-03-21T12:00:00.123456",
    )
    # For this test, we do not override send_slack_notification and send_email_notification.
    notify_extension.send_notification(params, end_time="2025-03-21T12:00:10.123456")

    # Verify that the dummy SMTP's send_message was called.
    notify_extension._config.smtp_instance.send_message.assert_called_once()

    # Verify that slack methods were called.
    notify_extension.slack_client.conversations_open.assert_called_once_with(
        users=[notify_extension._config.slack_user_id]
    )
    notify_extension.slack_client.chat_postMessage.assert_called_once()
