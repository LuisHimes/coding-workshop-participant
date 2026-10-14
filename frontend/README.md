# Coding Workshop - Frontend

## Overview

Project Tracker's web app: a single-page React application for desktop browsers, built with Vite and [Material UI](https://mui.com/material-ui/). React Router switches screens in the browser; the server only ever serves `index.html`, and CloudFront sends unknown paths to it so links like `/projects/12` work.

It covers every admin, manager and employee feature. Each screen shows only what the logged-in role may do, and the backend enforces the same rules.

## Admin features

| Screen          | What admins can do                                                                                   |
| --------------- | ---------------------------------------------------------------------------------------------------- |
| Dashboard       | Open, at-risk and off-track projects, employees in overtime, labor cost against budget (each number explained), project status table, and the message board with a filter for all boards or one project |
| Projects        | Search and filter (status, open or archived); long lists scroll with the headings kept in view; each open project's progress bar; create projects with a manager, dates, hours and budget |
| Calendar        | Month view of key dates only: project kickoffs and deadlines, milestone starts and deadlines (deadlines colored by status, overdue in red); busy days show three and "+N more"; filter by project; a scrolling list of the month's key dates |
| Project page    | Progress bar (milestones placed on the timeline by state, with today marked); edit everything including budget and manager; delete (archives it, kept for history); unarchive; budget estimate with "Use as budget"; health and deadline risk |
| · Team          | Add employees with planned hours (warns above 40 h/week), add a whole team, change hours, remove     |
| · Milestones    | Add, edit, start, complete, reopen and delete milestones; add, tick off, rename and delete tasks; assign members and mark their part finished |
| · Deliverables  | The dependency chain: order, what each milestone waits on, progress and assignees                    |
| · Hours         | Hours logged on the project, with corrections and deletes                                             |
| · Message board | The project's posts                                                                                   |
| Users           | Search and filter; create users (shows the generated ID and temporary password once); edit role, title, salary, manager and status; reset passwords |
| Teams           | Create a team for a manager; add or remove their direct reports; rename; delete                      |
| Milestone templates | A manager's predefined milestones (in order, with an optional usual length); create, edit, reorder, delete. On a project's Milestones tab, "Add from template" adds them with suggested dates you can change |
| Reports         | Project status, at-risk projects with reasons, budget consumed versus planned, resource allocation and over-allocation (filter by team) |
| Hours           | Every time entry, filtered by employee, project and dates; corrections and deletes                   |
| Audit log       | Every change and login, filtered by record type, record, user and date; changes shown as old → new    |
| Your profile    | Edit name and email; change password                                                                  |

Every screen, including login, has an **Appearance** button in the top bar: light or dark mode follows the browser's setting until someone picks Light or Dark, which is remembered in that browser.

## Manager features

Managers use the same screens, limited to their own work:

| Screen        | What managers can do                                                                                     |
| ------------- | -------------------------------------------------------------------------------------------------------- |
| Dashboard     | Their open projects at a glance, plus the message board                                                  |
| Projects      | Their own open projects with progress bars; edit details and status (not budget or manager); completing a project archives it |
| Calendar      | Key dates (kickoffs, milestone starts, deadlines) of their open projects                                                        |
| Project page  | Team (add employees or one of their teams), milestones, tasks, assignments, deliverables, hours (read-only), message board |
| Employees     | Every employee, with salaries, read-only                                                                 |
| Teams         | Create teams of their direct reports; manage members; rename; delete                                     |
| Milestone templates | Their own predefined milestones, added to their projects with a start and end date for each        |
| Reports       | Status, risk, budget and allocation for their projects and the employees on them                         |
| Hours         | Hours logged on their projects, read-only                                                                |
| Message board | On the dashboard: post to their projects' boards; delete their own posts                                 |

Managers don't see the audit log, can't create, delete or archive projects, and can't add or edit users. Other managers' and admins' names stay hidden from them.

## Employee features

| Screen        | What employees can do                                                                                  |
| ------------- | ------------------------------------------------------------------------------------------------------ |
| Home          | Their current milestone with its tasks to tick off, "Mark my part finished", this week's hours against 40, their projects, upcoming deadlines (next 30 days), the message board |
| My projects   | The open projects they're on with progress bars, without budgets or costs                               |
| Calendar      | Key dates (kickoffs, milestone starts, deadlines) of their projects                                                           |
| Project page  | Details, teammates, milestones (tick off tasks and mark their part finished on milestones they're assigned to), deliverables, their own hours with "Log hours", the message board |
| My hours      | Log, correct and delete their own hours; each save shows the week's total, flagged above 40              |
| Message board | On the home page: read announcements and their projects' posts; post to their projects; delete their own posts |
| Your profile  | Edit name and email; change password                                                                    |

Employees never see salaries, budgets or costs; the backend leaves them out of every response to employees.

## Structure

```
frontend/
├── index.html                # The single page
├── vite.config.js            # Dev server (port 3000), build chunks and test settings
└── src/
    ├── main.jsx              # Entry point
    ├── App.jsx               # Providers, lazy-loaded screens and routes per role
    ├── theme.js              # Material UI light and dark themes (chosen in context/ColorModeContext.jsx)
    ├── api/
    │   ├── client.js         # fetch wrapper: base URL, token, error messages
    │   └── endpoints.js      # Every backend endpoint, grouped by feature Lambda
    ├── context/              # App-wide state, each a provider plus its hook
    │   ├── AuthContext.jsx           # Login, session restore, logout on 401, role checks (useAuth, useRole)
    │   ├── ColorModeContext.jsx      # Light/dark mode (useColorMode)
    │   ├── DirectoryContext.jsx      # Users and projects by ID, to show names (useDirectory)
    │   └── NotificationsContext.jsx  # Snackbar confirmations and warnings (useNotify)
    ├── components/           # Layout, dialogs, tables, message board, shared pieces (common.jsx)
    │   └── project/          # Project page panels: team, milestones, deliverables
    ├── hooks/                # useApiData (loading and errors), useDebounced
    ├── pages/                # One component per screen
    ├── utils/format.js       # Money, hours, dates, labels
    ├── utils/milestones.js   # Milestone states (incl. overdue) and calendar-day helpers
    ├── utils/prefetch.js     # Downloads the other screens in the background once the browser is idle
    └── test/                 # Fake API, test setup, and tests by area: App (every screen renders), projects,
                              #   people (users, teams, audit, auth, API client), work (hours, messages,
                              #   reports), templates, color mode, prefetch
```

**Changing a backend endpoint** means editing [src/api/endpoints.js](src/api/endpoints.js) only. Requests go to `${VITE_API_URL}/api/<feature>/<path>`: locally `VITE_API_URL` is the dev proxy (`http://localhost:3001`), on AWS it is the CloudFront domain. `./bin/generate-env.sh` writes it to `.env.local`.

## Usage

### Local development

```sh
./bin/start-dev.sh              # LocalStack, backend Lambdas, proxy on :3001 and this app on :3000
```

Open `http://localhost:3000` and log in with `INITIAL_ADMIN_EMAIL` and `INITIAL_ADMIN_PASSWORD` from `backend/_shared/.env.development`. You'll be asked to choose a permanent password first.

To run only this app against an already running backend: `npm run dev`.

### Checks

```sh
npm run lint
npm test          # Vitest: every screen renders against a fake API, plus login and key flows
npm run test:coverage  # The same, failing unless every file is 100% covered (lines, branches, functions)
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
