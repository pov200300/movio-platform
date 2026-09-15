<?php
/**
 * Plugin Name: Headless WordPress CORS & REST Enabler
 * Description: Enables cross-origin resource sharing (CORS) for external frontends like Vercel.
 * Version: 1.0.0
 * Author: CineVault Architecture
 */

// 1. Send CORS headers on every REST API request
add_action('rest_api_init', function() {
    remove_filter('rest_pre_serve_request', 'rest_send_cors_headers');
    add_filter('rest_pre_serve_request', function($value) {
        header('Access-Control-Allow-Origin: *');
        header('Access-Control-Allow-Methods: GET, POST, OPTIONS, PUT, DELETE');
        header('Access-Control-Allow-Headers: Authorization, Content-Type, X-WP-Wpnonce, Accept');
        header('Access-Control-Allow-Credentials: true');
        return $value;
    });
}, 15);

// 2. Handle HTTP OPTIONS preflight checks cleanly
add_action('init', function() {
    if (isset($_SERVER['REQUEST_METHOD']) && $_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
        header('Access-Control-Allow-Origin: *');
        header('Access-Control-Allow-Methods: GET, POST, OPTIONS, PUT, DELETE');
        header('Access-Control-Allow-Headers: Authorization, Content-Type, X-WP-Wpnonce, Accept');
        header('Access-Control-Max-Age: 86400');
        status_header(200);
        exit();
    }
});
