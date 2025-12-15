import os
from urllib.parse import urljoin
import requests

# From https://docs.github.com/en/actions/reference/workflows-and-actions/variables
GITHUB_ENV = (
    "CI",
    "GITHUB_ACTION",
    "GITHUB_ACTOR",
    "GITHUB_EVENT_NAME",
    "GITHUB_BASE_REF",
    "GITHUB_HEAD_REF",
    "GITHUB_REF",
    "GITHUB_REF_NAME",
    "GITHUB_REF_TYPE",
    "GITHUB_REF_PROTECTED",
    "GITHUB_REPOSITORY",
    "GITHUB_RUN_ID",
    "GITHUB_WORKFLOW_REF",
)


# Mapping from Github repos => Lando repos
REPOSITORIES = {
    "mozilla-firefox/infra-testing": "infra-testing",
    "mozilla-firefox/firefox": "mozilla-central",
}


def main():
    if not os.environ.get("CI"):
        raise Exception("Only CI run is supported")

    # Setup Lando authentication from Github action secret
    lando_host = os.environ.get("LANDO_HOST", "https://api.lando.services.mozilla.com")
    lando_api_token = os.environ.get("LANDO_API_TOKEN")
    if not lando_api_token :
        raise Exception("Missing Lando API token as LANDO_API_TOKEN")
    headers = {
        "Authorization": f"Bearer {lando_api_token}",
        "User-Agent": f"Code-review-github-action/1.0",
    }

    pull_number = os.environ.get("GITHUB_PR_NUMBER")
    if not pull_number:
        raise Exception("Missing pull request number as GITHUB_PR_NUMBER")

    # Convert Github repos into Lando ones
    github_repo = os.environ.get("GITHUB_REPOSITORY")
    if not github_repo:
        raise Exception("Missing repository as GITHUB_REPOSITORY")
    lando_repo = REPOSITORIES.get(github_repo)
    if not lando_repo:
        raise Exception(f"Unknown github repo {github_repo}")

    url = urljoin(lando_host, f"/api/pulls/{lando_repo}/{pull_number}/try_jobs")
    print(f"Querying {url}")

    resp = requests.post(url, headers=headers)
    if not resp.ok:
        print("Error", resp.content)
    resp.raise_for_status()

    print("Success", resp.content)

if __name__ == '__main__':
    main()
