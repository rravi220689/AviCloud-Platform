FROM alpine:3.19

RUN apk add --no-cache samba shadow

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 139 445

ENTRYPOINT ["/entrypoint.sh"]
