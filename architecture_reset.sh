#!/usr/bin/env bash
set -euo pipefail

# architecture_reset.sh
# Deletes existing master + per-tenant SQLite databases and creates a fresh
# migrated database layout (control.db, ingress.db, platform-logs.db, tenants/).

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

architecture_reset() {
  local auto_yes=false
  local include_storage=false
  local custom_data_dir=""

  while [[ $# -gt 0 ]]; do
    case "$1" in
      -y|--yes|--force)
        auto_yes=true
        shift
        ;;
      --include-storage)
        include_storage=true
        shift
        ;;
      --data-dir)
        custom_data_dir="${2:-}"
        shift 2
        ;;
      *)
        echo "Unknown option: $1" >&2
        echo "Usage: ./architecture_reset.sh [--yes] [--include-storage] [--data-dir <path>]" >&2
        return 1
        ;;
    esac
  done

  cd "$SCRIPT_DIR"

  local target_data_dir="$custom_data_dir"
  if [[ -z "$target_data_dir" ]]; then
    if [[ -n "${DATA_DIR:-}" ]]; then
      target_data_dir="$DATA_DIR"
    elif [[ -f ".env" ]]; then
      local env_dir
      env_dir="$(grep -E '^[[:space:]]*DATA_DIR=' .env | tail -n 1 | cut -d '=' -f 2- | tr -d '"' | tr -d "'" | xargs || true)"
      target_data_dir="${env_dir:-.rsl-data}"
    else
      target_data_dir=".rsl-data"
    fi
  fi

  if [[ "$auto_yes" != "true" ]]; then
    echo "WARNING: This will permanently DELETE all platform and client tenant databases in: $target_data_dir"
    read -r -p "Type RESET to continue (anything else aborts): " reply
    if [[ "$reply" != "RESET" ]]; then
      echo "Aborted. No databases were modified."
      return 1
    fi
  fi

  echo "[architecture_reset] Removing old SQLite databases under: $target_data_dir"
  local reset_args=("--yes")
  if [[ "$include_storage" == "true" ]]; then
    reset_args+=("--include-storage")
  fi
  if [[ -n "$custom_data_dir" ]]; then
    reset_args+=("--data-dir" "$custom_data_dir")
  fi

  # Remove legacy or stale SQLite files if present before re-provisioning via tenancy engine
  if [[ -d "$target_data_dir/platform" ]]; then
    rm -rf "$target_data_dir/platform"
  fi
  if [[ -d "$target_data_dir/tenants" ]]; then
    rm -rf "$target_data_dir/tenants"
  fi
  if [[ "$include_storage" == "true" ]]; then
    rm -rf "$target_data_dir/storage" "$target_data_dir/backups"
  fi

  pnpm exec tsx "$SCRIPT_DIR/scripts/architecture-reset.ts" "${reset_args[@]}"
  echo "[architecture_reset] Fresh database architecture created cleanly."
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  architecture_reset "$@"
fi
