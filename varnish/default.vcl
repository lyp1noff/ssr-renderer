vcl 4.0;

backend default {
    .host = "ssr-proxy";
    .port = "3003";
    .first_byte_timeout = 30s;
    .between_bytes_timeout = 15s;
    .connect_timeout = 10s;
}

acl purge {
    "127.0.0.1";
    "localhost";
}

sub vcl_recv {
    if (req.method == "PURGE") {
        if (!client.ip ~ purge) {
            return (synth(403, "Forbidden"));
        }
        return (purge);
    }

    if (req.method != "GET" && req.method != "HEAD") {
        return (pass);
    }

    return (hash);
}

sub vcl_backend_response {
    if (beresp.status >= 400) {
        set beresp.uncacheable = true;
        return (deliver);
    }

    if (beresp.http.Cache-Control) {
        return (deliver);
    }

    # Default TTL
    set beresp.ttl = 1d;
    unset beresp.http.Set-Cookie;
    return (deliver);
}

sub vcl_deliver {
    if (obj.hits > 0) {
        set resp.http.X-Cache = "HIT";
    } else {
        set resp.http.X-Cache = "MISS";
    }
}
