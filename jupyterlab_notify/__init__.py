from .magics import NotifyCellCompletionMagics
from ._version import __version__


def _jupyter_labextension_paths():
    return [{
        "src": "labextension",
        "dest": "jupyterlab-notify"
    }]


def _jupyter_server_extension_points():
    return [{
        "module": "jupyterlab_notify"
    }]


def _load_jupyter_server_extension(server_app):
    pass


def load_ipython_extension(ipython):
    ipython.register_magics(NotifyCellCompletionMagics)
