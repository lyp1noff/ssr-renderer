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

    # Pass all non-GET/HEAD requests
    if (req.method != "GET" && req.method != "HEAD") {
        return (pass);
    }

    # Skip static files and API endpoints
    if (req.url ~ "\.(js|css|json|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot)$") {
        return (pass);
    }
    if (req.url ~ "^/(graphql|api|admin|static|fonts|assets|uploads|robots\.txt|sitemap\.xml)") {
        return (pass);
    }

    return (hash);
}

sub vcl_backend_response {
    if (beresp.status >= 400) {
        set beresp.uncacheable = true;
        return (deliver);
    }

    # Respect upstream cache-control
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
