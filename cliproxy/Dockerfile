ARG CLIPROXY_IMAGE=eceasy/cli-proxy-api:latest@sha256:3f74ca56cba8bea2a2a096a215bb774482d87d257da04c5047e6046493bfd644
FROM ${CLIPROXY_IMAGE}
# Non-root by default. Compose runs it as the config file owner (CLIPROXY_UID/GID).
# /root stays traversable, not listable, so configs with auth-dir /root/.cli-proxy-api keep working.
RUN groupadd --system --gid 10001 cliproxy \
 && useradd --system --uid 10001 --gid 10001 --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin cliproxy \
 && chmod 0711 /root \
 && install -d -o 10001 -g 10001 -m 0700 /root/.cli-proxy-api \
 && install -d -o 10001 -g 10001 -m 0755 /CLIProxyAPI/logs /CLIProxyAPI/plugins
USER 10001:10001
EXPOSE 8317 8085
CMD ["/CLIProxyAPI/CLIProxyAPI"]
