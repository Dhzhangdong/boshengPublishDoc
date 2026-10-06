#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
deploy_dir=${1:?Deployment directory required}
server_image=${2:?Image required}
version=${3:?Commit SHA required}
registry_user=${4:?Registry username required}
[[ "$deploy_dir" = publishDoc/test && "$version" =~ ^[0-9a-f]{40}$ ]]
[[ "$server_image" = "git.bosheng.online/lekutaoxian/publish-doc:$version" ]]
[[ "$registry_user" =~ ^[a-zA-Z0-9_][a-zA-Z0-9_.-]*$ ]]
test -n "${REGISTRY_TOKEN:-}"
cd "${PUBLISH_DOC_DEPLOY_ROOT:-$HOME}/$deploy_dir"
exec 9>.deploy.lock
flock -n 9 || { echo 'Another publishDoc deployment is running.' >&2; exit 1; }
next="docker-compose.$version.yml.next"
test -s "$next"
auth_dir=$(mktemp -d .registry-auth.XXXXXX)
cleanup() { sudo -n rm -f "$auth_dir/config.json"; rmdir "$auth_dir" 2>/dev/null || true; }
trap cleanup EXIT
docker_cmd() { sudo -n docker --config "$PWD/$auth_dir" "$@"; }
printf '%s' "$REGISTRY_TOKEN" | docker_cmd login git.bosheng.online --username "$registry_user" --password-stdin
unset REGISTRY_TOKEN
had_previous=false
if [ -s docker-compose.yml ] && [ -s .images.env ]; then
  cp docker-compose.yml docker-compose.yml.previous
  cp .images.env .images.env.previous
  had_previous=true
elif [ -e docker-compose.yml ] || [ -e .images.env ]; then
  echo 'Incomplete previous deployment metadata.' >&2; exit 1
fi
compose_file="$next"
image_file=".images.$version.env.next"
printf 'SERVER_IMAGE=%s\nSERVICE_VERSION=%s\n' "$server_image" "$version" > "$image_file"
compose() {
  local extra=()
  if [ -f .runtime.env ]; then extra+=(--env-file .runtime.env); fi
  docker_cmd compose "${extra[@]}" --env-file "$image_file" -f "$compose_file" "$@"
}
previous() {
  local extra=()
  if [ -f .runtime.env ]; then extra+=(--env-file .runtime.env); fi
  docker_cmd compose "${extra[@]}" --env-file .images.env.previous -f docker-compose.yml.previous "$@"
}
changed=false
recover() {
  local status=${1:-$?}
  trap - ERR INT TERM
  echo 'publishDoc deployment failed.' >&2
  if [ "$changed" = true ]; then
    # A failure while promoting metadata may have already renamed the candidate.
    if [ ! -f "$compose_file" ] && [ -f docker-compose.yml ]; then compose_file=docker-compose.yml; fi
    compose stop web || true
    if [ "$had_previous" = true ]; then
      previous up -d --no-deps web || echo 'Previous version could not start; manual recovery required.' >&2
      cp docker-compose.yml.previous docker-compose.yml
      cp .images.env.previous .images.env
    else
      rm -f docker-compose.yml .images.env
    fi
  fi
  exit "$status"
}
trap recover ERR
trap 'recover 130' INT
trap 'recover 143' TERM
compose config --quiet
compose pull web
changed=true
compose up -d --no-deps web
container=$(compose ps -q web)
test -n "$container"
ready=false
for ((i=0; i<24; i++)); do
  state=$(docker_cmd inspect --format '{{.State.Status}}/{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' "$container")
  if [ "$state" = running/healthy ]; then ready=true; break; fi
  case "$state" in exited/*|dead/*) break ;; esac
  sleep 5
done
[ "$ready" = true ]
compose exec -T web wget -q -O /dev/null http://127.0.0.1:8080/health.json
probes=$(compose exec -T web cat /usr/share/nginx/html/health-probes.txt)
test -n "$probes"
while IFS= read -r probe; do
  [[ ( "$probe" = /products/* || "$probe" = /articles/* ) && "$probe" != *..* ]]
  compose exec -T web wget -q -O /dev/null "http://127.0.0.1:8080$probe"
done <<< "$probes"
mapping=$(docker_cmd port "$container" 8080/tcp)
test -n "$mapping"
mv "$compose_file" docker-compose.yml
mv "$image_file" .images.env
trap - ERR INT TERM
echo "publishDoc deployed: $version; container=$container; listen=$mapping"
