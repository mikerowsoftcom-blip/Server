FROM ghcr.io/ggml-org/llama.cpp:server

COPY start.sh /start.sh
RUN chmod +x /start.sh

EXPOSE 10000

ENTRYPOINT ["/start.sh"]
