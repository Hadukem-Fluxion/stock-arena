#!/usr/bin/env bash
set -euo pipefail
[[ $(id -u) == 0 && ${1:-} == --ssh-source && $# == 2 && $2 =~ ^[0-9a-fA-F.:]+/(32|128)$ ]] || { echo "Use sudo bootstrap.sh --ssh-source <single-client-IP/32-or-128>." >&2; exit 1; }
source /etc/os-release
[[ $ID == ubuntu && $VERSION_ID == 24.04 ]] || { echo "Ubuntu 24.04 LTS is required." >&2; exit 1; }
folder=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
apt-get update
apt-get upgrade -y
apt-get install -y ca-certificates curl git nano ufw unattended-upgrades python3
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
printf 'Types: deb\nURIs: https://download.docker.com/linux/ubuntu\nSuites: noble\nComponents: stable\nArchitectures: %s\nSigned-By: /etc/apt/keyrings/docker.asc\n' "$(dpkg --print-architecture)" > /etc/apt/sources.list.d/docker.sources
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker
if [[ ! -e /swapfile ]]; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
fi
swapon --show=NAME --noheadings | grep -Fx /swapfile >/dev/null || { echo "Existing swapfile needs operator review; it was not reformatted." >&2; exit 1; }
grep -qE '^/swapfile[[:space:]]' /etc/fstab || printf '/swapfile none swap sw 0 0\n' >> /etc/fstab
install -m 644 "$folder/00-mstocks-ssh.conf" /etc/ssh/sshd_config.d/00-mstocks.conf
sshd -t
install -m 644 "$folder/20auto-upgrades" /etc/apt/apt.conf.d/20auto-upgrades
install -m 644 "$folder/52mstocks-security" /etc/apt/apt.conf.d/52mstocks-security
systemctl enable --now apt-daily.timer apt-daily-upgrade.timer
ufw default deny incoming
ufw default allow outgoing
ufw allow from "$2" to any port 22 proto tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
docker compose version
free -h
ufw status numbered
echo "Bootstrap complete. Verify effective SSH settings, reload ssh and test a second key-only session before closing this one."
