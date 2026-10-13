# Coding Workshop - Frontend

## Overview

Project Tracker's web app: a single-page React application for desktop browsers, built with Vite and [Material UI](https://mui.com/material-ui/). React Router switches screens in the browser; the server only ever serves `index.html`, and CloudFront sends unknown paths to it so links like `/projects/12` work.

It covers every admin, manager and employee feature. Each screen shows only what the logged-in role may do, and the backend enforces the same rules.

## Admin features

| Screen          | What admins can do                                                                                   |
| --------------- | ---------------------------------------------------------------------------------------------------- |
| Dashboard       | Open, at-risk and off-track projects, over-allocated employees, labor cost against budget, project status table, message board |
| Projects        | Search and filter (status, open or archived); create projects with a manager, dates, hours and budget |
| Project page    | Edit everything including budget and manager; delete (archive) with a reason; unarchive; budget estimate with "Use as budget"; health and deadline risk |
| · Team          | Add employees with planned hours (warns above 40 h/week), add a whole team, change hours, remove     |
| · Milestones    | Add, edit, start, complete, reopen and delete milestones; add, tick off, rename and delete tasks; assign members and mark their part finished |
| · Deliverables  | The dependency chain: order, what each milestone waits on, progress and assignees                    |
| · Hours         | Hours logged on the project, with corrections and deletes                                             |
| · Message board | The project's posts                                                                                   |
| Users           | Search and filter; create users (shows the generated ID and temporary password once); edit role, title, salary, manager and status; reset passwords |
| Teams           | Create a team for a manager; add or remove their direct reports; rename; delete                      |
| Reports         | Project status, at-risk projects with reasons, budget consumed versus planned, resource allocation and over-allocation (filter by team) |
| Hours           | Every time entry, filtered by employee, project and dates; corrections and deletes                   |
| Message board   | Announcements to everyone or posts to a project; delete                                               |
| Audit log       | Every change and login, filtered by record type, record, user and date; changes shown as old → new    |
| Your profile    | Edit name and email; change password                                                                  |

## Manager features

Managers use the same screens, limited to their own work:

| Screen        | What managers can do                                                                                     |
| ------------- | -------------------------------------------------------------------------------------------------------- |
| Dashboard     | Their open projects at a glance, plus the message board                                                  |
| Projects      | Their own open projects; edit details and status (not budget or manager); completing a project archives it |
| Project page  | Team (add employees or one of their teams), milestones, tasks, assignments, deliverables, hours (read-only), message board |
| Employees     | Every employee, with salaries, read-only                                                                 |
| Teams         | Create teams of their direct reports; manage members; rename; delete                                     |
| Reports       | Status, risk, budget and allocation for their projects and the employees on them                         |
| Hours         | Hours logged on their projects, read-only                                                                |
| Message board | Post to their projects' boards; delete their own posts                                                   |

Managers don't see the audit log, can't create, delete or archive projects, and can't add or edit users. Other managers' and admins' names stay hidden from them.

## Employee features

| Screen        | What employees can do                                                                                  |
| ------------- | ------------------------------------------------------------------------------------------------------ |
| Home          | Their current milestone with its tasks to tick off, "Mark my part finished", this week's hours against 40, their projects, the message board |
| My projects   | The open projects they're on, without budgets or costs                                                  |
| Project page  | Details, teammates, milestones (tick off tasks and mark their part finished on milestones they're assigned to), deliverables, their own hours with "Log hours", the message board |
| My hours      | Log, correct and delete their own hours; each save shows the week's total, flagged above 40              |
| Message board | Read announcements and their projects' posts; post to their projects; delete their own posts           |
| Your profile  | Edit name and email; change password                                                                    |

Employees never see salaries, budgets or costs; the backend leaves them out of every response to employees.

## Structure

```
frontend/
├── index.html                # The single page
├── vite.config.js            # Dev server (port 3000) and test settings
└── src/
    ├── main.jsx              # Entry point
    ├── App.jsx               # Providers and routes
    ├── theme.js              # Material UI theme
    ├── api/
    │   ├── client.js         # fetch wrapper: base URL, token, error messages
    │   └── endpoints.js      # Every backend endpoint, grouped by feature Lambda
    ├── auth/AuthContext.jsx  # Login, session restore, logout on 401
    ├── components/           # Layout, dialogs, tables, message board, shared pieces
    │   └── project/          # Project page panels: team, milestones, deliverables
    ├── hooks/                # useApiData (loading and errors), useDebounced
    ├── pages/                # One component per screen
    ├── utils/format.js       # Money, hours, dates, labels
    ├── test/                 # Fake API and test setup
    └── App.test.jsx          # Renders every screen against the fake API
```

**Changing a backend endpoint** means editing [src/api/endpoints.js](src/api/endpoints.js) only. Requests go to `${VITE_API_URL}/api/<feature>/<path>`: locally `VITE_API_URL` is the dev proxy (`http://localhost:3001`), on AWS it is the CloudFront domain. `./bin/generate-env.sh` writes it to `.env.local`.

## Usage

### Local development

```sh
./bin/start-dev.sh              # LocalStack, backend Lambdas, proxy on :3001 and this app on :3000
```

Open `http://localhost:3000` and log in as `ADMIN1` with `INITIAL_ADMIN_PASSWORD` from `backend/_shared/.env.development`. You'll be asked to choose a permanent password first.

To run only this app against an already running backend: `npm run dev`.

### Checks

```sh
npm run lint
npm test          # Vitest: every screen renders against a fake API, plus login and key flows
npm run build
```

### Cloud deployment

```sh
./bin/deploy-frontend.sh
```

Then open the CloudFront URL it prints.

## Clean Up

To remove all deployed resources (including frontend):

```sh
./bin/cleanup-environment.sh
```
