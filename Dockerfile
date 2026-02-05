FROM caddy:2-alpine

COPY public /usr/share/caddy

CMD ["sh", "-c", "caddy file-server --root /usr/share/caddy --listen :${PORT:-80}"]
