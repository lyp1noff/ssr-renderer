vcl 4.0;

backend default {
    .host = "renderer";
    .port = "3003";
    .connect_timeout = 3s;
    .first_byte_timeout = 40s;
    .between_bytes_timeout = 15s;
}

sub vcl_recv {
    if (req.method != "GET" && req.method != "HEAD") { return (synth(405)); }
    if (req.url ~ "^/(health|ready|metrics)([?]|$)") { return (pass); }
    if (req.http.Authorization || req.http.Cookie) { return (pass); }
    return (hash);
}

sub vcl_backend_response {
    if (bereq.is_bgfetch && beresp.status >= 500) { return (abandon); }
    if (beresp.status != 200 || beresp.http.X-SSR-Served != "true" ||
        beresp.http.Content-Type !~ "^text/html") {
        set beresp.uncacheable = true;
        set beresp.ttl = 0s;
        set beresp.grace = 0s;
        return (deliver);
    }
    set beresp.grace = 1m;
    set beresp.keep = 1m;
    return (deliver);
}

sub vcl_deliver {
    if (obj.hits > 0) { set resp.http.X-Cache = "HIT"; }
    else { set resp.http.X-Cache = "MISS"; }
    if (obj.hits > 0 && obj.ttl < 0s) { set resp.http.X-SSR-Stale = "true"; }
}
