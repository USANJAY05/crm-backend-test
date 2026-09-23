#!/bin/sh
set -eu
KC_DB="${KC_DB_NAME:-keycloak}"
KC_USER="${KC_DB_USER:-keycloak}"
KC_PASS="${KC_DB_PASS:-keycloak}"
mysql -uroot -p"${MYSQL_ROOT_PASSWORD}" <<SQL
CREATE DATABASE IF NOT EXISTS \\`${KC_DB}\\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '${KC_USER}'@'%' IDENTIFIED BY '${KC_PASS}';
GRANT ALL PRIVILEGES ON \\`${KC_DB}\\`.* TO '${KC_USER}'@'%';
FLUSH PRIVILEGES;
SQL
