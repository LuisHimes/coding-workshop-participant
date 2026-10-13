resource "random_id" "this" {
  byte_length = 4

  keepers = {
    seed_input = try(var.aws_app_code, terraform.workspace)
  }
}

resource "random_pet" "this" {
  length    = 3
  separator = "-"

  keepers = {
    seed_input = try(var.aws_app_code, terraform.workspace)
  }
}

# Signs the backend's login tokens (JWT_SECRET)
resource "random_password" "jwt_secret" {
  length  = 64
  special = false

  keepers = {
    seed_input = try(var.aws_app_code, terraform.workspace)
  }
}

# Temporary password for the first admin account (INITIAL_ADMIN_PASSWORD);
# the admin must change it at first login
resource "random_password" "initial_admin" {
  length  = 20
  special = false

  keepers = {
    seed_input = try(var.aws_app_code, terraform.workspace)
  }
}
