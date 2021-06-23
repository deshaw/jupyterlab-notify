import time
import uuid
import smtplib
from email.message import EmailMessage
from enum import Enum
from getpass import getuser

from IPython import get_ipython
from IPython.core.magic import Magics, cell_magic, line_magic, magics_class
from IPython.core.magic_arguments import argument, magic_arguments, parse_argstring
from IPython.display import display


_DEFAULT_SUCCESS_MESSAGE = "Cell execution completed successfully"
_DEFAULT_FAILURE_MESSAGE = "Cell execution failed"


class _NotificationType(Enum):
    """
    Supported notification types in jupyterlab extension
    """

    INIT = "INIT"
    NOTIFY = "NOTIFY"


class _Notification(object):

    NOTIFICATION_MIMETYPE = "application/desktop-notify+json"

    @property
    def message_type(self):
        return self._message_type

    @message_type.setter
    def message_type(self, msg_type):
        self._message_type = _NotificationType(msg_type)

    def __init__(self, message_type, title=None):
        """
        Used to send notifications to the client using custom mimetypes
        """
        self.message_type = message_type
        self.title = title

    def _repr_mimebundle_(self, **kwargs):
        return {
            self.NOTIFICATION_MIMETYPE: {
                "type": self.message_type.value,
                "payload": {"title": self.title},
                "id": str(uuid.uuid4()),
            }
        }


@magics_class
class NotifyCellCompletionMagics(Magics):
    def __init__(self, shell):
        super(NotifyCellCompletionMagics, self).__init__(shell)
        # Init message prompts the user for required permissions to display desktop notifications
        display(_Notification(_NotificationType.INIT))

    @magic_arguments()
    @argument(
        "--success",
        "-s",
        default=_DEFAULT_SUCCESS_MESSAGE,
        help="Title for the notification upon successful cell completion",
    )
    @argument(
        "--failure",
        "-f",
        default=_DEFAULT_FAILURE_MESSAGE,
        help="Title for the notification upon unsuccessful cell completion",
    )
    @argument(
        "--mail",
        "-m",
        action="store_true",
        default=False,
        help="When opted-in, a mail is sent as notification including the cell result",
    )
    @cell_magic
    def notify(self, line, cell):
        """
        Cell magic that notifies either via desktop notification or email

        """
        args = parse_argstring(self.notify_all, line)
        ip = get_ipython()
        exec_result = ip.run_cell(cell)
        self.handle_result(exec_result, args.mail, args.success, args.failure)

    def handle_result(self, exec_result, should_mail, success_msg, failure_msg):
        title = success_msg if exec_result.success else failure_msg
        if should_mail:

            message = EmailMessage()
            message["Subject"] = title
            message["From"] = getuser()
            message["To"] = getuser()

            # Append only string content to mail body - this can be later extended to
            # other MIME contents
            if exec_result.success:
                msg_body = str(exec_result.result) if exec_result.result else ""
            else:
                msg_body = (
                    str(exec_result.error_in_exec)
                    if exec_result.error_in_exec
                    else str(exec_result.error_before_exec)
                )

            # TODO: Add link to the notebook that executed this magic
            # Related Refs: https://github.com/ipython/ipython/issues/10123,
            # https://github.com/kzm4269/ipynb-path

            message.set_content(msg_body)

            # ASSUMPTION: smtp server to be running on localhost
            #
            #
            # The below is only a basic way to implement mail using smtplib -
            # given the number of ways this is set up in different orgs, the
            # is bound to evolve per those requirements.
            #
            # If this assumption does not hold true, this needs to accept
            # related args from the user to open a session with the target
            # SMTP server (in NotifyCellCompletionMagics initializer) / provide
            # hooks for users to plugin their implementations of mail
            with smtplib.SMTP("localhost") as smtp_conn:
                smtp_conn.send_message(message)

        else:
            display(_Notification(_NotificationType.NOTIFY, title))

    @magic_arguments()
    @argument(
        "--threshold",
        "-t",
        type=int,
        help=(
            "Notification is fired for cells that take more than this amount of time"
            " (in seconds). Defaults to 120 seconds"
        ),
    )
    @argument(
        "--success",
        "-s",
        default=_DEFAULT_SUCCESS_MESSAGE,
        help="Title for the notification upon successful cell completion",
    )
    @argument(
        "--failure",
        "-f",
        default=_DEFAULT_FAILURE_MESSAGE,
        help="Title for the notification upon unsuccessful cell completion",
    )
    @argument(
        "--mail",
        "-m",
        action="store_true",
        default=False,
        help=(
            "When opted-in, a mail is sent as notification including the cell result."
            " Defaults to False"
        ),
    )
    @argument(
        "--disable",
        "-d",
        action="store_true",
        help=(
            "Disable notebook notifications - clears threshold set for notifications"
            " (if any)"
        ),
    )
    @line_magic
    def notify_all(self, line):
        """
        Line magic that notifies for every cell that finishes execution after the given threshold

        Note that, when this magic is enabled, a notification will be triggered for cell execution
        failures (irrespective of the time it took to execute the cell)

        """
        args = parse_argstring(self.notify_all, line)

        if args.disable and (args.mail or args.threshold):
            raise ValueError("--disable cannot be used with --threshold or --mail")

        self.notify_threshold = args.threshold if args.threshold else 120
        self.should_notify_in_mail = args.mail
        self.success = args.success
        self.failure = args.failure

        ip = get_ipython()

        if args.disable:
            if self._pre_run_cell in ip.events.callbacks["pre_run_cell"]:
                ip.events.unregister("pre_run_cell", self._pre_run_cell)

            if self._post_run_cell in ip.events.callbacks["post_run_cell"]:
                ip.events.unregister("post_run_cell", self._post_run_cell)

            print("Notebook notifications are disabled")
            return

        # If a callback is already registered, skip re-registering
        if self._pre_run_cell not in ip.events.callbacks["pre_run_cell"]:
            ip.events.register("pre_run_cell", self._pre_run_cell)
        if self._post_run_cell not in ip.events.callbacks["post_run_cell"]:
            ip.events.register("post_run_cell", self._post_run_cell)

    def _pre_run_cell(self):
        self.run_start_time = time.time()

    def _post_run_cell(self, exec_result):
        # Do not run the hook for the cell where the magic is registered
        if not hasattr(self, "run_start_time"):
            return

        sec_elapsed = time.time() - self.run_start_time
        # Notify either if the threshold is breached or the execution failed
        if (sec_elapsed >= self.notify_threshold) or (
            exec_result.error_before_exec or exec_result.error_in_exec
        ):
            self.handle_result(
                exec_result, self.should_notify_in_mail, self.success, self.failure
            )
