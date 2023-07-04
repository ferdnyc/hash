output "setup_ecr" {
  description = "ECR repository for the setup image"
  value       = module.setup
}

output "migrate_ecr" {
  description = "ECR repository for the migrate image"
  value       = module.migrate
}

output "temporal_private_hostname" {
  description = "The private hostname of the Temporal server used with Service Discovery"
  value       = aws_lb.net_alb.dns_name
}
