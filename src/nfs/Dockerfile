FROM alpine:3.19
RUN apk add --no-cache unfs3 rpcbind bash
RUN mkdir -p /storage
EXPOSE 2049/tcp 2049/udp 111/tcp 111/udp
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
