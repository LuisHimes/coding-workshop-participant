# Main Service

Python [FastAPI](https://fastapi.tiangolo.com/) backend with PostgreSQL. It runs on AWS Lambda through [Mangum](https://mangum.fastapiexpert.com/).

## Structure

The service is split into layers. A request flows controller → service → repository → database, and each layer only calls the one below it.

| Layer         | Responsibility                                                                 |
| ------------- | ------------------------------------------------------------------------------ |
| `controller/` | HTTP: routes, status codes, request validation, choosing the response schema    |
| `service/`    | Business rules: who may do what, salary visibility, password hashing           |
| `repository/` | SQL only: one module per model, no permission checks                           |
| `models/`     | Table definitions, database rules (triggers), views and Pydantic schemas       |

```
main/
├── function.py          # Lambda entry point (function.handler), also runs uvicorn locally
├── app.py               # FastAPI app: middleware and router registration
├── middleware.py        # Request logging, security headers, exception handler, prefix stripping
├── config.py            # Settings loaded from environment variables and .env files
├── .env.sample          # Template listing every setting (committed)
├── .env.development     # Local development settings (not committed)
├── .env                 # Personal overrides and secrets (not committed)
├── database.py          # Reused connection, schema setup, migration runner
├── migrations/          # Numbered SQL migrations for existing databases
├── dependencies.py      # Dependency injection: builds repositories (and services) per request
├── controller/          # HTTP layer: routes, status codes, request validation
│   ├── auth.py          #   Login, your profile, change password
│   ├── health.py        #   Health checks
│   ├── users.py         #   /users
│   ├── projects.py      #   /projects, members, milestones, deliverables
│   ├── milestones.py    #   /milestones, /tasks, assignments
│   ├── time_entries.py  #   /time-entries
│   ├── messages.py      #   /messages
│   ├── reports.py       #   /reports
│   ├── teams.py         #   /teams, add a team to a project
│   └── audit.py         #   /audit
├── service/             # Business rules and permissions; calls repositories
│   ├── base.py          #   Role helpers (is_admin, require_role, ...)
│   ├── errors.py        #   NotFound / PermissionDenied / Conflict / InvalidRequest
│   ├── auth.py          #   Login, change password, first admin
│   ├── security.py      #   Password hashing and JWT tokens
│   ├── users.py         #   User management, salary visibility
│   ├── projects.py      #   Projects, members, archiving, budget estimate
│   ├── milestones.py    #   Milestones, tasks, assignments, automatic completion
│   ├── time_entries.py  #   Logged hours with weekly totals
│   ├── messages.py      #   Message board
│   ├── audit.py         #   Reading the audit log
│   ├── reports.py       #   Status, risk, allocation, deliverables, budget, home pages
│   └── teams.py         #   Teams of direct reports, staffing projects with a team
├── repository/          # SQL queries, one module per model
│   ├── base.py          #   Repository base class: takes the connection, shared CRUD helpers
│   ├── users.py         #   Never returns password_hash except for login checks
│   ├── projects.py      #   Projects, members, archive/unarchive
│   ├── milestones.py    #   Milestones, tasks, assignments, active milestone
│   ├── time_entries.py
│   ├── messages.py
│   ├── audit.py         #   Read-only audit log queries
│   └── dashboard.py     #   Reporting view queries
├── models/              # Table definitions, triggers, views and Pydantic schemas
│   ├── base.py          #   Shared SQL and constants (40 h week, 2080 h year)
│   ├── users.py         #   Admins, managers, employees
│   ├── projects.py      #   Projects and project members
│   ├── milestones.py    #   Milestones, their tasks and assigned employees
│   ├── time_entries.py  #   Hours logged by employees
│   ├── messages.py      #   Home page message board
│   ├── audit.py         #   Audit log and triggers
│   ├── auth.py          #   Token response schema
│   └── dashboard.py     #   Reporting views
├── test_app.py          # Routing and Lambda handler tests
├── test_middleware.py   # Logging, security header and exception handler tests
├── test_models.py       # Database rule tests against PostgreSQL
├── test_repository.py   # Repository tests against PostgreSQL
├── test_dependencies.py # Dependency injection tests
├── test_config.py       # Configuration loading tests
├── test_migrations.py   # Migration runner and migration tests
├── test_indexes.py      # Checks important queries can use their indexes
├── test_teams.py        # Team rules, service and routes
├── test_auth.py         # Login, token, password and role guard tests
├── test_services.py     # Business rule and permission tests for every service
├── test_controllers.py  # End-to-end API tests through HTTP
├── conftest.py          # Test fixture: a temporary schema per test
├── requirements.txt     # Lambda dependencies (installed by Terraform)
└── requirements-dev.txt # Local tooling: uvicorn, pytest, httpx2
```

## Endpoints

Every route needs a bearer token (see [Logging in](#logging-in)) except the health checks and `POST /auth/token`. Permissions are checked in the services, so a route returns 403 or 404 when your role doesn't allow it. All routes are also served under `/api/main/...`, the path CloudFront forwards on AWS. With the API running, interactive docs are at `/docs`.

| Method                | Path                                              | Description                                                        |
| --------------------- | ------------------------------------------------- | ------------------------------------------------------------------ |
| GET                   | `/health`, `/health/db`                           | Liveness and PostgreSQL checks (no login)                          |
| POST                  | `/auth/token`                                     | Log in; form fields `username`, `password` (no login)              |
| GET, PATCH            | `/auth/me`                                        | Your profile; change your own name and email                       |
| POST                  | `/auth/change-password`                           | Replace your password (required after a temporary one)             |
| GET, POST             | `/users`                                          | Search users (`role`, `manager_id`, `q`); admins create users      |
| GET, PATCH            | `/users/{user_id}`                                | View a user; admins edit role, title, salary, manager, status      |
| POST                  | `/users/{user_id}/reset-password`                 | Admins issue a new temporary password                              |
| GET, POST             | `/projects`                                       | Search projects (`q`, `status`, `archived`); admins also see archived ones, marked `archived: true`; admins create |
| GET, PATCH            | `/projects/{id}`                                  | View; managers edit (status `completed` archives it)               |
| DELETE                | `/projects/{id}`                                  | Admins delete a project by archiving it; optional body `{"reason": "deleted"}` (default) or `"completed"` |
| POST                  | `/projects/{id}/unarchive`                        | Admins restore an archived project                                 |
| GET                   | `/projects/{id}/budget-estimate`                  | Admins: what the team's planned hours cost                         |
| GET, POST             | `/projects/{id}/members`                          | Team; managers add employees (flags over 40 h/week)                |
| PATCH, DELETE         | `/projects/{id}/members/{user_id}`                | Change planned hours; remove from the project                      |
| GET, POST             | `/projects/{id}/milestones`                       | Milestones in order; managers add them                             |
| GET                   | `/projects/{id}/deliverables`                     | Progress, assignees and dependency chain of each milestone         |
| POST                  | `/projects/{id}/teams`                            | Add a whole team to a project: `{"team_id", "hours_per_week"}`     |
| GET, POST             | `/teams`                                          | Your teams (admins: all, `manager_id`); create a team              |
| GET, PATCH, DELETE    | `/teams/{id}`                                     | View, rename or delete a team                                      |
| GET, POST             | `/teams/{id}/members`                             | Members; add one of the manager's direct reports                   |
| DELETE                | `/teams/{id}/members/{user_id}`                   | Remove a member                                                    |
| GET                   | `/milestones/active`                              | Your active milestone                                              |
| GET, PATCH, DELETE    | `/milestones/{id}`                                | View; managers edit, start and complete; delete if not started     |
| GET, POST             | `/milestones/{id}/tasks`                          | Tasks; managers add them                                           |
| PATCH, DELETE         | `/tasks/{task_id}`                                | Mark done (assigned employees) or rename; delete                   |
| GET, POST             | `/milestones/{id}/assignments`                    | Assigned employees; managers assign project members                |
| PATCH, DELETE         | `/milestones/{id}/assignments/{user_id}`          | Mark your part `finished`; unassign                                |
| GET, POST             | `/time-entries`                                   | Logged hours (`user_id`, `project_id`, `start`, `end`); employees log |
| PATCH, DELETE         | `/time-entries/{id}`                              | Correct or remove your entry                                       |
| GET, POST             | `/messages`                                       | Message board (`project_id`, `limit`); post                        |
| DELETE                | `/messages/{id}`                                  | Delete your post (admins: any)                                     |
| GET                   | `/reports/home`                                   | Home page summary for your role                                    |
| GET                   | `/reports/projects`                               | Status, completion, budget and risk of each project                |
| GET                   | `/reports/at-risk`                                | Projects at risk of missing their deadlines, with reasons          |
| GET                   | `/reports/budget`                                 | Budget consumed versus planned                                     |
| GET                   | `/reports/allocation`, `/reports/over-allocated`  | Hours per employee per project; who is over 40 h/week (`team_id` filters to one team) |
| GET                   | `/audit`                                          | Admins: audit log (`entity`, `entity_id`, `actor_id`, `since`)     |

## Logging in

The API uses the OAuth2 password flow with JWT bearer tokens:

```sh
# 1. Log in with the 6-character user ID
curl -X POST http://localhost:3001/api/main/auth/token -d "username=ADMIN1" -d "password=..."
# -> {"access_token": "eyJ...", "token_type": "bearer", "expires_in": 3600, "must_change_password": true}

# 2. Send the token on every request
curl http://localhost:3001/api/main/auth/me -H "Authorization: Bearer eyJ..."

# 3. Users with a temporary password must change it first
curl -X POST http://localhost:3001/api/main/auth/change-password -H "Authorization: Bearer eyJ..." \
     -H "Content-Type: application/json" -d '{"current_password": "...", "new_password": "..."}'
```

- Until a temporary password is changed, every route except `/auth/me` and `/auth/change-password` returns 403.
- Failed logins return the same error whether the user ID or the password is wrong, and every attempt is written to the audit log (`LOGIN`, `LOGIN_FAILED`).
- The user is reloaded on every request, so deactivating someone ends their session immediately.
- Passwords are hashed with scrypt from Python's standard library.

**The first admin** (`ADMIN1`) is created at startup when no admin exists and `INITIAL_ADMIN_PASSWORD` is set. Locally, that password is in `.env.development`. On AWS, Terraform generates it:

```sh
cd infra && terraform output -raw initial_admin_password
```

**Protecting a route:** take one of these from [dependencies.py](dependencies.py) as a parameter.

| Dependency                          | Allows                                             |
| ----------------------------------- | -------------------------------------------------- |
| `CurrentUser`                       | Any logged-in user with a permanent password       |
| `AdminUser`                         | Admins only                                        |
| `ManagerOrAdminUser`                | Managers and admins                                |
| `CurrentUserAllowTemporaryPassword` | Also users with a temporary password (auth routes) |

```python
@router.post("/projects")
def create_project(body: ProjectCreate, admin: AdminUser, ...): ...
```

The dependency also tells the audit log who is acting, so every change made in that request is attributed to the user.

## Services

Each service method takes the acting user (from `CurrentUser`) as its first argument and checks permissions itself, so the rules hold whichever controller calls it. Services raise errors from [service/errors.py](service/errors.py). Business rules the database enforces (milestone order, one active milestone, ...) come back as conflicts with the database's own explanation.

| Role     | Can                                                                                                           |
| -------- | ------------------------------------------------------------------------------------------------------------- |
| Admin    | Everything: create users of any role (ID and temporary password generated), edit users, reset passwords, create projects, set budgets and managers, archive and unarchive, see archived projects, read the audit log |
| Manager  | See themselves, their own projects and employees (not other managers or admins); edit their own projects' details and status; add, edit and remove employees; manage milestones, tasks and assignments, and decide when milestones are completed; create teams of their direct reports and add a whole team to a project; see employees' salaries; post to their projects' boards; reports for their projects |
| Employee | See their open projects and their deliverables; tick off tasks and mark their part finished on milestones they're assigned to; log hours; edit their own name and email; post to their projects' boards. Never sees salaries or costs |

Completing work: employees tick off tasks, but only the project's manager (or an admin) decides a milestone is completed, and only once all its tasks are done. Completing the last milestone does not complete the project: the manager decides that by setting the project's status to completed, which the database allows only once every milestone is done. Completing a project archives it in the same step, with reason `completed`. Like any archived project, only admins can then see it; an admin can unarchive it, and its manager can reopen it as active. Project status moves planning → active → completed.

### Middleware

[middleware.py](middleware.py) wraps every request, outermost first:

1. **Request logging**: one JSON log line per request with `request_id`, `method`, `path`, `status`, `duration_ms` and `user_id`, at ERROR level for 5xx. Every response gets an `X-Request-ID` header; on Lambda it is AWS's request ID, so it matches the CloudWatch log prefix. Find a user's requests in CloudWatch Logs Insights with `filter @message like '"user_id": "ABC123"'`.
2. **Security headers** on every response: `Cache-Control: no-store` (responses carry salaries and tokens), `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Content-Security-Policy: frame-ancestors 'none'` and `Strict-Transport-Security`. A route can still set its own `Cache-Control`.
3. **Exception handler**: controllers never catch errors. Every error response is JSON with a `detail` message:

| Raised                                   | Status | Response                                                        |
| ---------------------------------------- | ------ | --------------------------------------------------------------- |
| `NotFoundError`                          | 404    | The service's message                                           |
| `PermissionDeniedError`                  | 403    | The service's message                                           |
| `ConflictError`                          | 409    | The service's message                                           |
| `InvalidRequestError`                    | 400    | The service's message                                           |
| Database unreachable (`OperationalError`) | 503   | "The database is unavailable; try again shortly", `request_id`  |
| Database rule the service didn't catch   | 409    | "This change conflicts with existing data", `request_id`        |
| Anything else                            | 500    | "Something went wrong on our side", `request_id`; the traceback is logged, never sent |

FastAPI still handles its own errors: 422 for invalid input, 401 and 404 for unknown routes, with the same `detail` shape.

### Reports

[service/reports.py](service/reports.py) answers the platform's key questions:

| Question                                               | Method                | Who                        |
| ------------------------------------------------------ | --------------------- | -------------------------- |
| What is the current status of each active project?     | `project_health`      | Managers (own), admins     |
| Which projects are at risk of missing their deadlines? | `projects_at_risk`    | Managers (own), admins     |
| How are resources allocated across projects?           | `resource_allocation` | Managers (own team), admins |
| What are the key deliverables and their completion?    | `deliverables`        | Anyone who can see the project |
| Which team members are over-allocated?                 | `over_allocated`      | Managers (own team), admins |
| What is the dependency chain between deliverables?     | `deliverables`        | Anyone who can see the project |
| How much budget has been consumed versus planned?      | `budget`              | Managers (own), admins     |

`manager_home` gives the at-a-glance summary for the home page (pair it with the message board), and `employee_home` shows an employee their active milestone and this week's hours.

**Deadline risk** (`assess_risk`): a project is *off track* when it is past its projected end date or over budget, and *at risk* when it has overdue milestones, no milestones once started, more hours logged than allocated, or progress trailing the timeline or spending by more than 20 percentage points. Each rating comes with plain-language reasons.


[config.py](config.py) loads and validates every setting once at startup; the app reads them from `config.settings`. Each value comes from the first of these that sets it:

1. Real environment variables. Terraform injects the `POSTGRES_*` variables into the Lambda this way, both on AWS and in LocalStack.
2. `.env`: your personal overrides and real secrets.
3. `.env.development`: shared local development settings, loaded only when `APP_ENV` is `development`.

Neither file is committed (the root `.gitignore` ignores `.env*` except `.env.sample`). To set up a new machine:

```sh
cd backend/main
cp .env.sample .env.development
python3 -c "import secrets; print(secrets.token_urlsafe(48))"   # paste into JWT_SECRET
```

| Variable                          | Default            | Purpose                                         |
| --------------------------------- | ------------------ | ----------------------------------------------- |
| `APP_ENV`                         | see below          | `development` or `production`                   |
| `LOG_LEVEL`                       | `INFO`             | `DEBUG`, `INFO`, `WARNING` or `ERROR`           |
| `POSTGRES_HOST` / `_PORT`         | `localhost` / 5432 | Database server                                 |
| `POSTGRES_NAME` / `_USER` / `_PASS` | `postgres` / `postgres` / empty | Database and credentials     |
| `POSTGRES_CONNECT_TIMEOUT`        | 15                 | Seconds before a connection attempt fails       |
| `JWT_SECRET`                      | required           | Signs access tokens; at least 32 characters     |
| `JWT_ALGORITHM`                   | `HS256`            | `HS256`, `HS384` or `HS512`                     |
| `JWT_ACCESS_TOKEN_EXPIRE_MINUTES` | 60                 | How long a login lasts                          |
| `JWT_ISSUER`                      | `coding-workshop`  | Issuer claim in tokens                          |
| `INITIAL_ADMIN_ID`                | `ADMIN1`           | User ID of the first admin                      |
| `INITIAL_ADMIN_EMAIL`             | `admin@example.com` | Email of the first admin                       |
| `INITIAL_ADMIN_PASSWORD`          | none               | Temporary password; no admin is created without it |

`APP_ENV` defaults to `production` when Terraform marks the Lambda as running on AWS (`IS_LOCAL=false`), and to `development` otherwise. In production the `.env` files are never read, and Terraform leaves dotfiles out of the deployment package anyway, so **every setting must come from Lambda environment variables on AWS**. Terraform generates `JWT_SECRET` and `INITIAL_ADMIN_PASSWORD` for AWS (in `infra/main.tf`) and injects them. Locally it leaves them unset, so `.env.development` applies.

Keep the `.env` files readable (mode 644): LocalStack runs the Lambda as a different user, and it fails to start if it can't read `.env.development`.

## Dependency injection

Nothing reaches for a global: each layer receives what it needs. Repositories are classes that take a database connection in their constructor, and services will take repositories the same way. [dependencies.py](dependencies.py) is the one place that wires them together, using FastAPI's `Depends`, so FastAPI builds them for each request.

```python
from dependencies import ProjectRepositoryDep

@router.get("/projects")
def list_projects(projects: ProjectRepositoryDep):
    return projects.find()
```

Outside the API (scripts, tests), build them directly: `ProjectRepository(connection)`.

To swap an implementation, override its provider. This is how tests run routes against a temporary schema or a fake:

```python
app.dependency_overrides[get_db] = lambda: test_connection
app.dependency_overrides[get_project_repository] = FakeProjectRepository
```

## Data model

The schema is created automatically on the first database connection; see [Migrations](#migrations) for how it changes over time.

| Table                   | Purpose                                                                           |
| ----------------------- | --------------------------------------------------------------------------------- |
| `users`                 | 6-character ID (also the username), role, job title, salary, temporary password flag |
| `projects`              | Manager, dates, allocated hours, budget, status, archive fields                   |
| `project_members`       | Employees on a project and their planned hours per week                           |
| `milestones`            | Ordered checkpoints within a project, with their own dates                        |
| `milestone_tasks`       | Requirements that must be done before a milestone completes                       |
| `milestone_assignments` | Employees working on a milestone, and when each finished their part               |
| `time_entries`          | Hours logged per day against a project and, optionally, a milestone               |
| `messages`              | Message board posts, global or per project                                        |
| `teams`                 | Named groups of a manager's direct reports                                        |
| `team_members`          | Who is on each team                                                               |
| `audit_log`             | Every change: what, who and when                                                  |

Views: `project_status` (completion, hours, labor cost against budget), `weekly_hours` and `employee_allocation` (both flag more than 40 hours a week).

### Rules enforced by PostgreSQL

- Employees report to exactly one manager, and the manager must have the manager role. Managers who still have employees can't change role.
- Every project has one manager. Only employees can be project members, and milestone assignees must be members of the project.
- Milestones run in order: a milestone can start only after every earlier one is completed, and can complete only when all its tasks are done.
- A team belongs to one manager and holds only their direct reports; moving an employee to another manager takes them off the old manager's teams.
- An employee can have only one active milestone across all non-archived projects. An assignment is active while the milestone is in progress and the employee hasn't finished their part. Finishing their part, or completing the milestone, frees them for another. Employees can be assigned to upcoming milestones in advance.
- A project can be completed only when all its milestones are completed. Archiving needs a reason (`deleted` or `completed`), and `completed` only fits a completed project.
- Every insert, update and delete on these tables is written to `audit_log`. Updates record only the changed fields, and password hashes are never logged. Call `AuditRepository.set_actor(user_id)` at the start of each request so entries record who made the change.

### Rules enforced by the services

Rules that depend on who is asking (permissions, salary visibility, password handling) live in the services; see [Services](#services).

## Migrations

The schema is set up automatically on the first database connection, in one all-or-nothing transaction under a lock, so concurrent cold starts can't race.

- **The models are the latest schema.** Each model's `SCHEMA` SQL describes the tables as they should be now. A fresh database is built from it directly, and every migration is recorded as already applied.
- **Migrations update existing databases.** The SQL files in [migrations/](migrations/) run once each, in filename order, and are recorded in the `schema_migrations` table. Pending migrations run before the models' `SCHEMA`, so views and functions are recreated against the migrated tables.

| Migration                              | What it does                                                                 |
| -------------------------------------- | ---------------------------------------------------------------------------- |
| `001_remove_closed_project_status.sql` | Turns closed projects into completed ones and removes the `closed` status    |
| `002_add_search_and_lookup_indexes.sql` | Trigram search indexes on users and projects, plus indexes for assignments by project, hours by project and date, newest messages, and filtered audit log queries |

To change the schema:

1. Change the model's `SCHEMA` SQL so fresh databases get the new shape.
2. Add `migrations/NNN_short_description.sql` (the next number, three digits) that changes an existing database to match. Name new constraints explicitly so later migrations can refer to them.
3. Add a test in [test_migrations.py](test_migrations.py) that rebuilds the old shape, runs `create_schema`, and checks the result.

Migrations never run in reverse. To undo one, add a new migration.

## Adding a resource

Using `teams` as an example:

1. `models/teams.py`: add a `SCHEMA` SQL string (idempotent: `CREATE TABLE IF NOT EXISTS`, `CREATE OR REPLACE ...`) and Pydantic schemas. A brand-new table needs no migration; changes to existing tables do (see [Migrations](#migrations)).
2. Add it to `SCHEMA` in `database.py`, after the tables it references, and to `AUDITED_TABLES` in `models/audit.py`.
3. `repository/teams.py`: add a `TeamRepository(Repository)` class with the SQL queries.
4. `service/teams.py`: add a `TeamService` class that takes the repositories it needs in its constructor.
5. `dependencies.py`: add providers for both, with `TeamRepositoryDep` and `TeamServiceDep` aliases.
6. `controller/teams.py`: add a router whose routes take `TeamServiceDep`.
7. Import the router in `app.py` and register it with `app.include_router(...)`.

## Running

```sh
# Full local stack (LocalStack + proxy on :3001)
./bin/start-dev.sh
curl http://localhost:3001/api/main/health/db

# Just the API, with interactive docs at http://localhost:8000/docs
cd backend/main
python3.13 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
.venv/bin/python function.py

# Tests (model tests are skipped if PostgreSQL is not reachable)
.venv/bin/pytest

# Deploy to AWS
./bin/deploy-backend.sh
```

## Local hot reload and Python versions

Locally, LocalStack runs the code straight from this folder, using packages that `./bin/start-dev.sh` installs here with `pip install --target`. If plain `pip` on your machine belongs to a Python version other than 3.13, compiled packages such as `pydantic_core` fail to import (`cannot import name ... from 'pydantic_core._pydantic_core'`). To fix it, delete the installed package folders and reinstall with the Lambda's Python version:

```sh
cd backend/main
python3.13 -m pip install --target=. -r requirements.txt
```

AWS deploys are not affected, because Terraform packages with `python3.13`.
