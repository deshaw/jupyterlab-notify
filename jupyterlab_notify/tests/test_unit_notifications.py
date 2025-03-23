import json
import threading
import pytest
from unittest.mock import MagicMock
from email.message import EmailMessage

from jupyterlab_notify import extension
from jupyterlab_notify.config import NotificationParams
from pathlib import Path


@pytest.fixture
def dummy_config_file(tmp_path, monkeypatch):
    # Set up a fake home directory with a .jupyter folder
    fake_home = tmp_path
    jupyter_dir = fake_home / ".jupyter"
    jupyter_dir.mkdir()

    # Create the dummy config file in the .jupyter folder
    dummy_file = jupyter_dir / "jupyterlab_notify_config.json"
    config_data = {
        "email": "test@example.com",
        "slack_token": "xoxb-dummy-slack-token",
        "slack_user_id": "U12345678",
        "slack_channel_name": "general",
    }
    dummy_file.write_text(json.dumps(config_data))

    # Patch Path.home() to return our fake home directory
    monkeypatch.setattr(Path, "home", lambda: fake_home)
    return config_data


@pytest.fixture
def notify_extension(dummy_config_file):
    # Create an instance of your NotifyExtension.
    ext = extension.NotifyExtension()
    ext._init_config()
    ext._init_logging()

    # Replace the SMTP instance with a dummy object.
    dummy_smtp = MagicMock()
    dummy_smtp.send_message = MagicMock()
    ext._config.smtp_instance = dummy_smtp

    # Replace slack_client with a dummy that simulates a working client.
    dummy_slack_client = MagicMock()
    dummy_slack_client.conversations_open.return_value = {
        "channel": {"id": "D12345678"}
    }
    ext.slack_client = dummy_slack_client
    ext.slack_imported = True
    return ext


def test_send_slack_notification(notify_extension):
    """Test that send_slack_notification opens a DM and sends a message."""
    test_message = "Test Slack Message"
    notify_extension.send_slack_notification(test_message)

    # Verify that conversations_open was called to get DM channel.
    notify_extension.slack_client.conversations_open.assert_called_once_with(
        users=[notify_extension._config.slack_user_id]
    )
    notify_extension.slack_client.chat_postMessage.assert_called_once_with(
        channel="D12345678", text=test_message
    )


def test_send_email_notification(notify_extension):
    """Test that send_email_notification builds an EmailMessage and calls send_message."""
    test_message = "Test Email Message"
    notify_extension.send_email_notification(test_message)

    dummy_smtp = notify_extension._config.smtp_instance
    dummy_smtp.send_message.assert_called_once()

    sent_msg = dummy_smtp.send_message.call_args[0][0]
    assert isinstance(sent_msg, EmailMessage)
    assert sent_msg["From"] == notify_extension.email
    assert sent_msg["To"] == notify_extension.email
    assert test_message in sent_msg.get_content()


def test_send_notification_modes(notify_extension, monkeypatch):
    """Parametrized test for different notification modes."""
    # mode, success, expected_slack, expected_email
    test_cases = [
        ("default", True, True, True),
        ("default", False, True, True),
        ("never", True, False, False),
        ("never", False, False, False),
        ("on-error", True, False, False),
        ("on-error", False, True, True),
    ]

    for mode, success, expected_slack, expected_email in test_cases:
        params = NotificationParams(
            cell_id="cell123",
            mode=mode,
            slackEnabled=True,
            emailEnabled=True,
            successMessage="Success",
            failureMessage="Failure",
            threshold=5,
            success=success,
            error="Error occurred" if not success else None,
            start_time="2025-03-21T12:00:00.123456",
        )
        slack_called = False
        email_called = False

        def fake_slack(message):
            nonlocal slack_called
            slack_called = True

        def fake_email(message):
            nonlocal email_called
            email_called = True

        monkeypatch.setattr(notify_extension, "send_slack_notification", fake_slack)
        monkeypatch.setattr(notify_extension, "send_email_notification", fake_email)

        notify_extension.send_notification(
            params, end_time="2025-03-21T12:00:10.123456"
        )
        assert slack_called == expected_slack
        assert email_called == expected_email


def test_no_notification_below_threshold(notify_extension, monkeypatch):
    """No notifications if execution time is below threshold in default mode."""
    params = NotificationParams(
        cell_id="cell123",
        mode="default",
        slackEnabled=True,
        emailEnabled=True,
        successMessage="Success",
        failureMessage="Failure",
        threshold=5,
        success=True,
        start_time="2025-03-21T12:00:00.123456",
    )
    slack_called = False
    email_called = False

    def fake_slack(message):
        nonlocal slack_called
        slack_called = True

    def fake_email(message):
        nonlocal email_called
        email_called = True

    monkeypatch.setattr(notify_extension, "send_slack_notification", fake_slack)
    monkeypatch.setattr(notify_extension, "send_email_notification", fake_email)

    notify_extension.send_notification(params, end_time="2025-03-21T12:00:02.123456")
    assert slack_called == False
    assert email_called == False


def test_send_notification_with_timeout(notify_extension, monkeypatch):
    """Test that a running timer causes the notification message to indicate a timeout."""
    params = NotificationParams(
        cell_id="cell_timeout",
        mode="custom-timeout",
        slackEnabled=True,
        emailEnabled=True,
        successMessage="Success",
        failureMessage="Failure",
        threshold=1,
        success=True,
    )
    # Create and start a dummy timer to simulate an active timeout.
    dummy_timer = threading.Timer(10, lambda: None)
    dummy_timer.start()
    params.timer = dummy_timer

    messages = {}

    def fake_slack(msg):
        messages["slack"] = msg

    def fake_email(msg):
        messages["email"] = msg

    monkeypatch.setattr(notify_extension, "send_slack_notification", fake_slack)
    monkeypatch.setattr(notify_extension, "send_email_notification", fake_email)

    notify_extension.send_notification(params)
    dummy_timer.cancel()

    assert "Timeout" in messages.get("slack", "")
    assert "Timeout" in messages.get("email", "")
