"""Background worker for the Demo Shop: shows FlagLens detecting flags in Python.

Run it with:  pip install flagsmith && FLAGSMITH_ENV_KEY=<Development key from .env> python worker.py
"""

import os

from flagsmith import Flagsmith

flagsmith = Flagsmith(
    environment_key=os.environ["FLAGSMITH_ENV_KEY"],
    api_url=os.environ.get("FLAGSMITH_API_URL", "http://localhost:8000") + "/api/v1/",
)


def send_order_emails() -> None:
    flags = flagsmith.get_environment_flags()

    # Same detection as Flagsmith's Code References: hover the key to see every environment.
    if flags.is_feature_enabled("maintenance_mode"):
        print("Maintenance mode: not sending emails")
        return

    limit = flags.get_feature_value("rate_limit_per_minute")
    print(f"Sending at most {limit} emails per minute")

    if flags.is_feature_enabled("new_checkout"):
        print("Using the new checkout confirmation template")


if __name__ == "__main__":
    send_order_emails()
