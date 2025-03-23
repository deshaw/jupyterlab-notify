import json
import logging
import threading
from http import HTTPStatus
from typing import Any, Dict, Union

import tornado.web
from jupyter_server.base.handlers import JupyterHandler
from jupyter_server.extension.handler import ExtensionHandlerMixin

from .config import NotificationParams, notification_params_from_dict


def setup_logger(name: str) -> logging.Logger:
    """Setup and return a logger with a console handler."""
    logger = logging.getLogger(name)
    logger.setLevel(logging.DEBUG)
    if not logger.hasHandlers():
        console_handler = logging.StreamHandler()
        console_handler.setLevel(logging.DEBUG)
        logger.addHandler(console_handler)
    return logger


class NotifyHandler(ExtensionHandlerMixin, JupyterHandler):
    """
    Handler to register cell IDs for notifications.

    GET:
        Returns the status of nbmodel event listening and notification configurations.

    POST:
        Registers a cell ID and schedules a notification if a threshold is set.
    """

    def initialize(self, extension_app: Any, *args: Any, **kwargs: Any) -> None:
        self.logger = setup_logger("jupyter-notify")
        self.extension_app = extension_app
        super().initialize(*args, **kwargs)

    @tornado.web.authenticated
    def get(self) -> None:
        """Check if the extension is listening for nbmodel events and verify configuration."""
        self.logger.debug(
            f"Checking nbmodel listener: {self.extension_app.is_listening}"
        )
        slack_configured = bool(
            self.extension_app.slack_client
            and (
                self.extension_app.slack_user_id
                or self.extension_app.slack_channel_name
            )
        )
        email_configured = bool(self.extension_app.email) and bool(
            self.extension_app._config.smtp_instance
        )

        self.set_status(HTTPStatus.OK)
        self.finish(
            {
                "nbmodel_installed": self.extension_app.is_listening,
                "slack_configured": slack_configured,
                "email_configured": email_configured,
            }
        )

    @tornado.web.authenticated
    async def post(self) -> None:
        """Register a cell ID for notifications and optionally set up a timeout timer."""
        params, error = self._parse_request_body(self.request.body)
        if error:
            self.set_status(HTTPStatus.BAD_REQUEST)
            self.finish({"error": error})
            return

        self.logger.debug(f"Registering notification for cell_id: {params.cell_id}")

        # If a timeout threshold is configured, schedule a timer to trigger notification.
        if params.mode in ("custom-timeout"):
            timer = threading.Timer(
                params.threshold, self.extension_app.send_notification, args=(params,)
            )
            params.timer = timer
            timer.start()

        self.extension_app.cell_ids[params.cell_id] = params
        self.set_status(HTTPStatus.OK)
        self.finish({"accepted": True})

    def _parse_request_body(self, body: bytes) -> Union[NotificationParams, str]:
        """
        Parse the JSON body and validate it against NotificationParams.

        Returns:
            Tuple of (params, error). If parsing is successful, error is an empty string.
        """
        try:
            data: Dict[str, Any] = json.loads(body)
            params = notification_params_from_dict(data)
            return params, ""
        except json.JSONDecodeError:
            return None, "Invalid JSON in request"
        except ValueError as exc:
            return None, str(exc)


class NotifyTriggerHandler(ExtensionHandlerMixin, JupyterHandler):
    """
    Handler to trigger a notification directly.

    POST:
        Validates and sends a notification immediately.
    """

    def initialize(self, extension_app: Any, *args: Any, **kwargs: Any) -> None:
        self.extension_app = extension_app
        super().initialize(*args, **kwargs)

    @tornado.web.authenticated
    async def post(self) -> None:
        """Trigger a notification immediately based on the provided parameters."""
        params, error = self._parse_request_body(self.request.body)
        if error:
            self.set_status(HTTPStatus.BAD_REQUEST)
            self.finish({"error": error})
            return

        # If a timer exists, it is due to timout!
        if params.timer:
            # Starting a dummy timer as placeholder (TODO consider revisiting the strategy)
            params.timer = threading.Timer(10, lambda *args: None)
            params.timer.start()

        self.extension_app.send_notification(params)
        self.set_status(HTTPStatus.OK)
        self.finish({"done": True})

    def _parse_request_body(self, body: bytes) -> Union[NotificationParams, str]:
        """
        Parse and validate the JSON body for notification trigger.

        Returns:
            Tuple of (params, error). If successful, error is an empty string.
        """
        try:
            data: Dict[str, Any] = json.loads(body)
            params = notification_params_from_dict(data)
            return params, ""
        except json.JSONDecodeError:
            return None, "Invalid JSON in request"
        except ValueError as exc:
            return None, str(exc)
