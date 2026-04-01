-- Construction payroll v2: employees, periods, timesheet lines (Senior Floors CRM)
-- Run via: node database/migrate-construction-payroll.js

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS `construction_payroll_employees` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(255) NOT NULL,
  `role` varchar(128) DEFAULT NULL,
  `phone` varchar(64) DEFAULT NULL,
  `email` varchar(255) DEFAULT NULL,
  `payment_type` enum('daily','hourly','mixed') NOT NULL DEFAULT 'daily',
  `daily_rate` decimal(12,2) NOT NULL DEFAULT 0.00,
  `hourly_rate` decimal(12,2) NOT NULL DEFAULT 0.00,
  `overtime_rate` decimal(12,2) NOT NULL DEFAULT 0.00,
  `payment_method` varchar(64) DEFAULT NULL COMMENT 'check, ach, cash, zelle, etc.',
  `user_id` int(11) DEFAULT NULL COMMENT 'optional link to CRM user',
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_active` (`is_active`),
  KEY `idx_user_id` (`user_id`),
  CONSTRAINT `fk_cpe_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `construction_payroll_periods` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(255) NOT NULL,
  `frequency` enum('weekly','biweekly','monthly') NOT NULL DEFAULT 'biweekly',
  `start_date` date NOT NULL,
  `end_date` date NOT NULL,
  `status` enum('open','closed') NOT NULL DEFAULT 'open',
  `closed_at` datetime DEFAULT NULL,
  `closed_by` int(11) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_dates` (`start_date`,`end_date`),
  KEY `idx_status` (`status`),
  CONSTRAINT `fk_cpp_closed_by` FOREIGN KEY (`closed_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `construction_payroll_timesheets` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `period_id` int(11) NOT NULL,
  `employee_id` int(11) NOT NULL,
  `project_id` int(11) DEFAULT NULL,
  `project_id_norm` int(11) GENERATED ALWAYS AS (ifnull(`project_id`,0)) STORED,
  `work_date` date NOT NULL,
  `days_worked` decimal(5,2) NOT NULL DEFAULT 0.00 COMMENT '1 or 0.5 for daily; optional for hourly',
  `regular_hours` decimal(8,2) NOT NULL DEFAULT 0.00 COMMENT 'for hourly / mixed',
  `overtime_hours` decimal(8,2) NOT NULL DEFAULT 0.00,
  `notes` text DEFAULT NULL,
  `calculated_amount` decimal(14,2) NOT NULL DEFAULT 0.00,
  `created_by` int(11) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_period_emp_proj_day` (`period_id`,`employee_id`,`work_date`,`project_id_norm`),
  KEY `idx_period` (`period_id`),
  KEY `idx_employee` (`employee_id`),
  KEY `idx_project` (`project_id`),
  KEY `idx_work_date` (`work_date`),
  CONSTRAINT `fk_cpt_period` FOREIGN KEY (`period_id`) REFERENCES `construction_payroll_periods` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_cpt_employee` FOREIGN KEY (`employee_id`) REFERENCES `construction_payroll_employees` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_cpt_project` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_cpt_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
