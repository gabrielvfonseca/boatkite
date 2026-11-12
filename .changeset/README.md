# boatkite

This file explains how our change set works.

## When do I create a changeset?

- When you're making a change to a published package that should be noted in
  the changelog and released.

## When do I NOT create a changeset?

- When you're making a change that doesn't need to be released — e.g. docs,
  CI, or internal tooling.

## How do I create a changeset?

Run `npx changeset`. It will guide you through picking the bump type
(major/minor/patch), naming the change, and writing a short summary. Each
changeset lives in its own `.changeset/<name>.md` file.

On every push to `main`, the Release workflow runs `changeset version`:
it bumps versions, writes `CHANGELOG.md`, and tags + publishes a GitHub
Release. You don't run versioning by hand.
