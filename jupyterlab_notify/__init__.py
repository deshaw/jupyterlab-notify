import json
from pathlib import Path
from .magics import NotifyCellCompletionMagics
from ._version import __version__

HERE = Path(__file__).parent.resolve()

with (HERE / "labextension" / "package.json").open() as fid:
    data = json.load(fid)


def _jupyter_labextension_paths():
    return [{"src": "labextension", "dest": data["name"]}]


def _load_jupyter_server_extension(server_app):
    # Nothing to do for now
    pass


def load_ipython_extension(ipython):
    ipython.register_magics(NotifyCellCompletionMagics)
