#!/usr/bin/env bash
# Isolated simulations: all Docker/sudo/sleep calls are replaced, no remote access.
set -Eeuo pipefail
script_dir=$(cd "$(dirname "$0")" && pwd)
fixture=$(mktemp -d)
trap 'rm -rf "$fixture"' EXIT
mkdir -p "$fixture/bin"
cat > "$fixture/bin/sudo" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
if [ "$1" = -n ]; then shift; fi
if [ "$1" = rm ]; then exec "$@"; fi
test "$1" = docker; shift
if [ "$1" = --config ]; then shift 2; fi
printf '%s\n' "$*" >> "$MOCK_LOG"
case "$1" in
 login) cat >/dev/null ;;
 inspect) if [ "$SCENARIO" = health_failure ]; then echo exited/unhealthy; else echo running/healthy; fi ;;
 port) echo '192.168.1.85:15120' ;;
 compose)
   case " $* " in
     *' pull web '*) if [ "$SCENARIO" = pull_failure ]; then exit 9; fi ;;
     *' ps -q web '*) echo mock-container ;;
     *' cat /usr/share/nginx/html/health-probes.txt '*) printf '/products/sample/01.html\n/products/sample/pdfs/manual.pdf\n/articles/\n/articles/pdfs/sample.pdf\n' ;;
   esac ;;
 *) exit 98 ;;
esac
MOCK
printf '#!/usr/bin/env bash\nexit 0\n' > "$fixture/bin/sleep"
cat > "$fixture/bin/mv" <<'MOCK'
#!/usr/bin/env bash
if [ "$SCENARIO" = promotion_failure ] && [ "${*: -1}" = .images.env ]; then exit 27; fi
exec /bin/mv "$@"
MOCK
chmod +x "$fixture/bin/sudo" "$fixture/bin/sleep" "$fixture/bin/mv"
export PATH="$fixture/bin:$PATH"
version=0123456789012345678901234567890123456789
image="git.bosheng.online/lekutaoxian/publish-doc:$version"
for scenario in success health_failure pull_failure first_failure promotion_failure; do
  task_root="$fixture/$scenario"
  mkdir -p "$task_root/publishDoc/test"
  task_dir="$task_root/publishDoc/test"
  printf 'versioned-compose\n' > "$task_dir/docker-compose.$version.yml.next"
  if [ "$scenario" != first_failure ]; then
    printf 'old-compose\n' > "$task_dir/docker-compose.yml"
    printf 'SERVER_IMAGE=old-image\n' > "$task_dir/.images.env"
  fi
  export PUBLISH_DOC_DEPLOY_ROOT="$task_root" MOCK_LOG="$task_root/docker.log" REGISTRY_TOKEN=mock-token
  export SCENARIO="$scenario"
  if [ "$scenario" = first_failure ]; then export SCENARIO=health_failure; fi
  result=0
  bash "$script_dir/deploy.sh" publishDoc/test "$image" "$version" mock-user > "$task_root/result.log" 2>&1 || result=$?
  case "$scenario" in
    success)
      test "$result" = 0
      grep -Fq "$image" "$task_dir/.images.env"
      grep -Fq '/products/sample/pdfs/manual.pdf' "$MOCK_LOG"
      grep -Fq '/articles/pdfs/sample.pdf' "$MOCK_LOG"
      ;;
    health_failure)
      test "$result" != 0
      grep -Fxq 'old-compose' "$task_dir/docker-compose.yml"
      grep -Fq 'docker-compose.yml.previous up -d --no-deps web' "$MOCK_LOG"
      ;;
    pull_failure)
      test "$result" != 0
      ! grep -Fq ' up -d ' "$MOCK_LOG"
      grep -Fxq 'old-compose' "$task_dir/docker-compose.yml"
      ;;
    first_failure)
      test "$result" != 0
      test ! -e "$task_dir/.images.env"
      grep -Fq ' stop web' "$MOCK_LOG"
      ;;
    promotion_failure)
      test "$result" != 0
      grep -Fxq 'old-compose' "$task_dir/docker-compose.yml"
      grep -Fxq 'SERVER_IMAGE=old-image' "$task_dir/.images.env"
      grep -Fq 'docker-compose.yml.previous up -d --no-deps web' "$MOCK_LOG"
      ;;
  esac
  echo "部署模拟通过：$scenario"
done
