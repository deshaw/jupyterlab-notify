# jupyterlab-notify


[![PyPI version][pypi-image]][pypi-url] [![PyPI DM][pypi-dm-image]][pypi-url]
[![Github Actions Status][github-status-image]][github-status-url] [![Binder][binder-image]][binder-url]

JupyterLab extension to notify cell completion

![notify-extension-in-action](https://github.com/deshaw/jupyterlab-notify/blob/main/docs/notify-screenshot.png?raw=true)

This is inspired by the notebook version [here](https://github.com/ShopRunner/jupyter-notify).

## Usage

### Register magics

```python
%load_ext jupyterlab_notify
```

### Notify completion of single cell:
```python
%%notify
import time
time.sleep(1)
```

### Mail output upon completion (with optional title for successfull execution)

```python
%%notify --mail --success 'Long-running cell in <foo> notebook is done!'
time.sleep(1)
```

**Note:** Mail requires/assumes that you have an SMTP server running on "localhost" - refer [SMTP doc](https://docs.python.org/3/library/smtplib.html#smtplib.SMTP.connect) for more details.
In case this assumption does not hold true for you, please open an issue with relevant details.

### Failure scenarios
```python
%%notify -f 'Long-running cell in <foo> notebook failed'
raise ValueError
```

### Threshold-based notifications (unit in seconds)
```python
%notify_all --threshold 1
time.sleep(1)
```

Once enabled, `notify_all` will raise a notification for cells that either exceed the given threshold or raise exception. This ability can also be used to check if/when all cells in a notebook completes execution. For instance,
```python
# In first cell
%notify_all -t 86400 -f 'Notebook execution failed'
# ...
# ...
# In last cell
%%notify -s 'Notebook execution completed'
```

### Disable notifications
```python
%notify_all --disable
time.sleep(1)
```

### Learn more
```python
%%notify?
```

```python
%notify_all?
```

## Troubleshoot

If you notice that the desktop notifications are not showing up, check the below:
1. Make sure JupyterLab is running in a secure context (i.e. either using HTTPS or localhost)
2. If you've previously denied notification permissions for the site, update the browser settings accordingly. In Chrome, you can do so by navigating to `Setttings -> Privacy and security -> Site Settings -> Notifications` and updating the permissions against your JupyterLab URL.
3. Verify that notifications work for your browser. You may need to configure an OS setting first. You can test on [this site](https://web-push-book.gauntface.com/demos/notification-examples/).

## Requirements

* JupyterLab >= 3.0

## Install

To install this package with [`pip`](https://pip.pypa.io/en/stable/) run

```bash
pip install jupyterlab_notify
```

## Contributing

### Development install

Note: You will need NodeJS to build the extension package.

The `jlpm` command is JupyterLab's pinned version of
[yarn](https://yarnpkg.com/) that is installed with JupyterLab. You may use
`yarn` or `npm` in lieu of `jlpm` below.

```bash
# Clone the repo to your local environment
# Change directory to the jupyterlab_notify directory
# Install package in development mode
pip install -e .
# Link your development version of the extension with JupyterLab
jupyter-labextension develop . --overwrite
# Rebuild extension Typescript source after making changes
jlpm run build
```

You can watch the source directory and run JupyterLab at the same time in different terminals to watch for changes in the extension's source and automatically rebuild the extension.

```bash
# Watch the source directory in one terminal, automatically rebuilding when needed
jlpm run watch
# Run JupyterLab in another terminal
jupyter lab
```

With the watch command running, every saved change will immediately be built locally and available in your running JupyterLab. Refresh JupyterLab to load the change in your browser (you may need to wait several seconds for the extension to be rebuilt).

By default, the `jlpm run build` command generates the source maps for this extension to make it easier to debug using the browser dev tools. To also generate source maps for the JupyterLab core extensions, you can run the following command:

```bash
jupyter lab build --minimize=False
```

### Uninstall

```bash
pip uninstall jupyterlab_notify
```

## Publishing

Before starting, you'll need to have run: `pip install twine jupyter_packaging`

1. Update the version in `package.json` and update the release date in `CHANGELOG.md`
2. Commit the change in step 1, tag it, then push it

```
git commit -am <msg>
git tag vX.Z.Y
git push && git push --tags
```

3. Create the artifacts

```
rm -rf dist
python setup.py sdist bdist_wheel
```

4. Test this against the test pypi. You can then install from here to test as well:

```
twine upload --repository-url https://test.pypi.org/legacy/ dist/*
# In a new venv
pip install --index-url https://test.pypi.org/simple/ jupyterlab_notify
```

5. Upload this to pypi:

```
twine upload dist/*
```

### Uninstall

```bash
pip uninstall jupyterlab_notify
```


## History

This plugin was contributed back to the community by the [D. E. Shaw group](https://www.deshaw.com/).

<p align="center">
    <a href="https://www.deshaw.com">
       <img src="https://www.deshaw.com/assets/logos/blue_logo_417x125.png" alt="D. E. Shaw Logo" height="75" >
    </a>
</p>

## License

This project is released under a [BSD-3-Clause license](https://github.com/deshaw/jupyterlab-notify/blob/master/LICENSE.txt).

"Jupyter" is a trademark of the NumFOCUS foundation, of which Project Jupyter is a part.

[pypi-url]: https://pypi.org/project/jupyterlab-notify
[pypi-image]: https://img.shields.io/pypi/v/jupyterlab-notify
[pypi-dm-image]: https://img.shields.io/pypi/dm/jupyterlab-notify
[github-status-image]: https://github.com/deshaw/jupyterlab-notify/workflows/Build/badge.svg
[github-status-url]: https://github.com/deshaw/jupyterlab-notify/actions?query=workflow%3ABuild
[binder-image]: https://mybinder.org/badge_logo.svg
[binder-url]: https://mybinder.org/v2/gh/deshaw/jupyterlab-notify.git/main?urlpath=lab%2Ftree%2Fnotebooks%2Findex.ipynb
