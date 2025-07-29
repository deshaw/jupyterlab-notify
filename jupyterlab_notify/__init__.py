from .magics import NotifyCellCompletionMagics
from ._version import __version__

from .extension import NotifyExtension


def _jupyter_labextension_paths():
    return [{"src": "labextension", "dest": "jupyterlab-notify"}]


def _jupyter_server_extension_points():
    return [{"module": "jupyterlab_notify", "app": NotifyExtension}]


def load_ipython_extension(ipython):
    ipython.register_magics(NotifyCellCompletionMagics)
