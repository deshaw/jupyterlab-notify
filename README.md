# jupyterlab-notify

[![PyPI version][pypi-image]][pypi-url] [![PyPI DM][pypi-dm-image]][pypi-url]
[![Github Actions Status][github-status-image]][github-status-url] [![Binder][binder-image]][binder-url]

JupyterLab extension to notify cell completion

## Usage

The `jupyterlab-notify` extension allows you to receive notifications about cell execution results in JupyterLab. Notifications are configured through cell metadata or the JupyterLab interface, providing seamless integration and easier management of notification preferences. Notifications can be sent via desktop pop-ups, Slack messages, or emails, depending on your configuration.

> [!NOTE]
> JupyterLab Notify v2 supports `jupyter-server-nbmodel`(>= v0.1.1a2), enabling notifications to work even after the browser has been closed. To enable browser-less notification support, install JupyterLab Notify with server-side execution dependencies using:
>
> ```bash
> pip install jupyterlab-notify[server-side-execution]
> ```
>
> JupyterLab Notify v2 requires execution timing data, so it automatically sets `record_timing` to true in the notebook settings.

### Configuration

To configure the **jupyterlab-notify** extension for Slack and email notifications, create a file named `jupyter_notify_config.json` and place it in a directory listed under the `config` section of `jupyter --paths` (e.g., `~/.jupyter/jupyter_notify_config.json`). This file defines settings for the `NotificationConfig` class.

#### Sample Configuration File

Here’s an example configuration enabling Slack and email notifications:

```json
{
  "NotificationConfig": {
    "email": "example@domain.com",
    "slack_token": "xoxb-abc123-your-slack-token",
    "slack_user_id": "U98765432"
  }
}
```

- **`slack_token`**: A Slack bot token used to send notifications to your Slack workspace.

  - **How to get it**: See [Slack API Quickstart](https://api.slack.com/quickstart) to create a bot and obtain a token.
  - **Required Bot Token Scopes**: Your Slack app must have the following OAuth scopes granted under **OAuth & Permissions → Bot Token Scopes** in the [Slack API dashboard](https://api.slack.com/apps):

    | Scope               | Purpose                                                                             |
    | ------------------- | ----------------------------------------------------------------------------------- |
    | `chat:write`        | Post messages to channels or DMs the bot is a member of                             |
    | `chat:write.public` | Post to public channels without the bot needing to join first                       |
    | `im:write`          | Open direct message conversations with users (required when `slack_user_id` is set) |

- **`slack_channel_name`**: The name of the Slack channel (e.g., `"notifications"`) where messages will be posted.
- **`email`**: The email address to receive notifications.
  - **Note**: Requires an SMTP server. For setup help, see [this SMTP guide](https://mailtrap.io/blog/setup-smtp-server/).

#### Additional Configuration Options

Beyond the commonly used settings above, the following options are available for advanced use:

- **`slack_user_id`**: A Slack user ID for sending direct messages instead of channel posts (e.g., `"U12345678"`).
- **`smtp_class`**: Fully qualified name of the SMTP class (default: `"smtplib.SMTP"`).
- **`smtp_args`**: Arguments for the SMTP class constructor, as a string (default: `["localhost"]`).

These settings allow for customization, such as using a custom SMTP server or changing the SMTP port from the default `25` to others (e.g., `["localhost", 125]`), or targeting a specific Slack channel or user.

### Notification Modes

You can control when notifications are sent by setting a mode for each cell. Modes can be configured through the JupyterLab interface by clicking on the bell icon in the cell toolbar.

![image](https://github.com/deshaw/jupyterlab-notify/blob/main/docs/celltoolbar-menu-screenshot.png?raw=true)

**Supported modes include:**

- `default`: Notification is sent only if cell execution exceeds the threshold time (default: 30 seconds). No notification if execution time is below the threshold.
- `never`: Disables notifications for the cell.
- `on-error`: Sends a notification only if the cell execution fails with an error.
- `custom-timeout`: Sends a notification as soon as the cell-execution exceeds a timeout value specified for that cell. Users can either choose a pre-existing timeout value or set a custom one.

### Default Threshold

Configure the default threshold value in JupyterLab’s settings:

1. Go to Settings Editor.
2. Select Execution Notifications.
3. Set "Threshold for default notifications": 5 (in seconds) to apply to cells using the `default` mode.

### Desktop Notifications

Desktop notifications are enabled by default and appear as pop-up alerts on your system.

![image](https://github.com/deshaw/jupyterlab-notify/blob/main/docs/desktop-notification.png?raw=true)

### Slack Notifications

Slack notifications are sent to the configured channel, requiring the setup described in the Configuration section.

### Email Notifications

Email notifications are sent to the configured email address, also requiring the setup from the Configuration section.

#### Configuration warning

If your email or Slack notifications are not configured but you attempt to enable them through the settings editor, a warning will be displayed when you try to execute a cell in the JupyterLab interface.

![image](https://github.com/deshaw/jupyterlab-notify/blob/main/docs/configuration-warning-screenshot.png?raw=true)

## Troubleshoot

If you notice that the desktop notifications are not showing up, check the below:

1. Make sure JupyterLab is running in a secure context (i.e. either using HTTPS or localhost)
2. If you've previously denied notification permissions for the site, update the browser settings accordingly. In Chrome, you can do so by navigating to `Setttings -> Privacy and security -> Site Settings -> Notifications` and updating the permissions against your JupyterLab URL.
3. Verify that notifications work for your browser. You may need to configure an OS setting first. You can test on [this site](https://web-push-book.gauntface.com/demos/notification-examples/).

## Requirements

- JupyterLab >= 4.0

## Install

To install this package with [`pip`](https://pip.pypa.io/en/stable/) run

```bash
pip install jupyterlab_notify
```

To install with server-side execution dependencies run

```bash
pip install jupyterlab_notify[server-side-execution]
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

# If you need server-side execution dependencies, install with:
pip install -e .[server-side-execution]

# If you want to install test dependencies as well, use:
pip install -e .[tests]

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

The initial version of this extension was inspired by the notebook version [here](https://github.com/ShopRunner/jupyter-notify).

This plugin was contributed back to the community by the [D. E. Shaw group](https://www.deshaw.com/).

<p align="center">
    <a href="https://www.deshaw.com">
       <img src="https://www.deshaw.com/assets/logos/blue_logo_417x125.png" alt="D. E. Shaw Logo" height="75" >
    </a>
</p>

## License

This project is released under a [BSD-3-Clause license](https://github.com/deshaw/jupyterlab-notify/blob/master/LICENSE.txt).

We love contributions! Before you can contribute, please sign and submit this [Contributor License Agreement (CLA)](https://www.deshaw.com/oss/cla).
This CLA is in place to protect all users of this project.

"Jupyter" is a trademark of the NumFOCUS foundation, of which Project Jupyter is a part.

[pypi-url]: https://pypi.org/project/jupyterlab-notify
[pypi-image]: https://img.shields.io/pypi/v/jupyterlab-notify
[pypi-dm-image]: https://img.shields.io/pypi/dm/jupyterlab-notify
[github-status-image]: https://github.com/deshaw/jupyterlab-notify/workflows/Build/badge.svg
[github-status-url]: https://github.com/deshaw/jupyterlab-notify/actions?query=workflow%3ABuild
[binder-image]: https://mybinder.org/badge_logo.svg
[binder-url]: https://mybinder.org/v2/gh/deshaw/jupyterlab-notify.git/main?urlpath=lab%2Ftree%2Fnotebooks%2FNotify.ipynb
