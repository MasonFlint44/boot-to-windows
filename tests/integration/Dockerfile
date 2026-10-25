# GNOME Shell integration-test image. One Dockerfile for every GNOME major;
# the Fedora release is the knob (see FEDORA_FOR_GNOME in run.sh):
#   GNOME 45 = fedora:39   46 = fedora:40   47 = fedora:41
#   GNOME 48 = fedora:42   49 = fedora:43   50 = fedora:44
ARG FEDORA=44
FROM fedora:${FEDORA}
ARG FEDORA
# ARCHIVE=1 points dnf at archives.fedoraproject.org (needed once a release
# has been EOL long enough that the mirror metalink stops serving it).
ARG ARCHIVE=0

RUN set -eux; \
    if [ "$ARCHIVE" = 1 ]; then \
      for f in /etc/yum.repos.d/fedora*.repo; do \
        sed -i -e 's/^metalink=/#metalink=/' \
               -e 's|^#\?baseurl=http.*/pub/fedora/linux|baseurl=https://archives.fedoraproject.org/pub/archive/fedora/linux|' "$f"; \
      done; \
    fi; \
    dnf -y install --setopt=install_weak_deps=False \
        gnome-shell dbus-daemon glib2 dconf mesa-dri-drivers \
        util-linux procps-ng; \
    dnf clean all; rm -rf /var/cache/dnf /var/cache/libdnf5 /usr/share/doc /usr/share/man; \
    useradd -m -u 1000 tester; \
    gnome-shell --version

# Shims: pkexec + efibootmgr fakes that log argv and edit the fixture efivars.
COPY harness/shims/pkexec harness/shims/efibootmgr /usr/bin/
COPY harness/ /opt/harness/
# Test-only helper extension: flips global.context.unsafe_mode so that
# org.gnome.Shell.Eval works (no CLI flag for that exists on 45..50).
RUN set -eux; \
    rm -rf /opt/harness/shims; \
    mkdir -p /usr/share/gnome-shell/extensions; \
    mv /opt/harness/harness-extension /usr/share/gnome-shell/extensions/harness@btw.test; \
    chmod 755 /usr/bin/pkexec /usr/bin/efibootmgr /opt/harness/*.sh

ENTRYPOINT ["/opt/harness/entrypoint.sh"]
