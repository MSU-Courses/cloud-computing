provider "aws" {
  region = "eu-central-1"
}

resource "aws_ecr_repository" "catalog" {
  name                 = "catalog"
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }
}
