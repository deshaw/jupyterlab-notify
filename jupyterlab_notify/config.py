from pathlib import Path
from traitlets.config import Configurable
from traitlets import Unicode, default, Any
from importlib import import_module
import inspect
from dataclasses import dataclass, fields
from typing import Optional, Dict
from threading import Timer


@dataclass
class NotificationParams:
    cell_id: str
    mode: str
    slackEnabled: bool
    emailEnabled: bool
    successMessage: str
    failureMessage: str
    threshold: int
    error: Optional[str] = None
    success: Optional[bool] = False
    timer: Optional[Timer] = None
    start_time: Optional[str] = None
    notebook_name: Optional[str] = None
    execution_count: Optional[int] = None


def notification_params_from_dict(data: Dict[str, Any]) -> NotificationParams:
    """Convert JSON data to NotificationParams."""

    # Get valid field names from NotificationParams
    allowed_fields = {f.name for f in fields(NotificationParams)}

    # Filter out unexpected fields
    filtered_data = {k: v for k, v in data.items() if k in allowed_fields}

    return NotificationParams(**filtered_data)


class SMTPConfigurationError(Exception):
    pass


class NotificationConfig(Configurable):
    smtp_class: str = Unicode(
        "smtplib.SMTP",
        config=True,
        help="Fully qualified class name for the SMTP class to use",
    )

    smtp_args: str = Any(
        ["localhost"],
        config=True,
        help="Arguments to pass to the SMTP class constructor, as a string",
    )

    email = Unicode(
        help="User's email for notifications",
        allow_none=True,
        default_value=None,
        config=True,
    )

    slack_token = Unicode(
        help="Slack bot token for notifications",
        allow_none=True,
        default_value=None,
        config=True,
    )

    slack_user_id = Unicode(
        help="Slack user ID for direct messages",
        allow_none=True,
        default_value=None,
        config=True,
    )

    slack_channel_name = Unicode(
        help="Slack channel Name for notifications",
        allow_none=True,
        default_value=None,
        config=True,
    )

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.smtp_instance = None
        self._setup_smtp_instance()

    def _setup_smtp_instance(self):
        try:
            smtp_class = self._import_smtp_class()
            self._validate_smtp_class(smtp_class)
            self.smtp_instance = self._create_smtp_instance(smtp_class)
            self._validate_smtp_instance(self.smtp_instance)
        except SMTPConfigurationError as e:
            print(f"SMTP Configuration Error: {str(e)}")

    def _import_smtp_class(self):
        try:
            module_name, class_name = self.smtp_class.rsplit(".", 1)
        except ValueError:
            raise SMTPConfigurationError(
                f"Invalid smtp_class format: {self.smtp_class}. "
                "It should be in the format 'module.ClassName'."
            )

        try:
            module = import_module(module_name)
        except ImportError:
            raise SMTPConfigurationError(f"Could not import module: {module_name}")

        try:
            return getattr(module, class_name)
        except AttributeError:
            raise SMTPConfigurationError(
                f"Class {class_name} not found in module {module_name}"
            )

    def _validate_smtp_class(self, smtp_class):
        if not inspect.isclass(smtp_class):
            raise SMTPConfigurationError(f"{smtp_class.__name__} is not a class")

        if not hasattr(smtp_class, "send_message") or not callable(
            getattr(smtp_class, "send_message")
        ):
            raise SMTPConfigurationError(
                f"{smtp_class.__name__} does not have a callable 'send_message' method"
            )

    def _create_smtp_instance(self, smtp_class):
        args = self._process_smtp_args()

        try:
            if isinstance(args, dict):
                return smtp_class(**args)
            elif isinstance(args, (list, tuple)):
                return smtp_class(*args)
            else:
                return smtp_class()
        except Exception as e:
            raise SMTPConfigurationError(
                f"Failed to instantiate {smtp_class.__name__}: {str(e)}"
            )

    def _validate_smtp_instance(self, smtp_instance):
        if not hasattr(smtp_instance, "connect") or not callable(
            getattr(smtp_instance, "connect")
        ):
            raise SMTPConfigurationError(
                f"{type(smtp_instance).__name__} instance does not have a callable 'connect' method"
            )

    def _process_smtp_args(self):
        if self.smtp_args is None:
            return []

        if isinstance(self.smtp_args, str):
            try:
                import ast

                return ast.literal_eval(self.smtp_args)
            except:
                return self.smtp_args
        elif callable(self.smtp_args):
            return self.smtp_args()
        else:
            return self.smtp_args
