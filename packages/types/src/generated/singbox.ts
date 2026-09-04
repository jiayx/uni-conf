// Generated from the official sing-box 1.14.0 schema. Do not edit by hand.

export type SingboxNativeOutbound =
  | {
      type: "anytls";
      tag?: string;
      detour?: string;
      bind_interface?: string;
      inet4_bind_address?: string;
      inet6_bind_address?: string;
      bind_address_no_port?: boolean;
      protect_path?: string;
      routing_mark?: number | string;
      reuse_addr?: boolean;
      netns?: string;
      connect_timeout?: Duration;
      tcp_fast_open?: boolean;
      tcp_multi_path?: boolean;
      disable_tcp_keep_alive?: boolean;
      tcp_keep_alive?: Duration;
      tcp_keep_alive_interval?: Duration;
      udp_fragment?: boolean;
      domain_resolver?: DomainResolver;
      network_strategy?: "default" | "fallback" | "hybrid";
      network_type?: InterfaceType | InterfaceType[];
      fallback_network_type?: InterfaceType | InterfaceType[];
      fallback_delay?: Duration;
      server?: string;
      server_port?: number;
      tls?: OutboundTLSOptions;
      password?: string;
      idle_session_check_interval?: Duration;
      idle_session_timeout?: Duration;
      min_idle_session?: number;
      client_metadata?: string;
    }
  | {
      type: "direct";
      tag?: string;
      detour?: string;
      bind_interface?: string;
      inet4_bind_address?: string;
      inet6_bind_address?: string;
      bind_address_no_port?: boolean;
      protect_path?: string;
      routing_mark?: number | string;
      reuse_addr?: boolean;
      netns?: string;
      connect_timeout?: Duration;
      tcp_fast_open?: boolean;
      tcp_multi_path?: boolean;
      disable_tcp_keep_alive?: boolean;
      tcp_keep_alive?: Duration;
      tcp_keep_alive_interval?: Duration;
      udp_fragment?: boolean;
      domain_resolver?: DomainResolver;
      network_strategy?: "default" | "fallback" | "hybrid";
      network_type?: InterfaceType | InterfaceType[];
      fallback_network_type?: InterfaceType | InterfaceType[];
      fallback_delay?: Duration;
    }
  | {
      type: "http";
      tag?: string;
      detour?: string;
      bind_interface?: string;
      inet4_bind_address?: string;
      inet6_bind_address?: string;
      bind_address_no_port?: boolean;
      protect_path?: string;
      routing_mark?: number | string;
      reuse_addr?: boolean;
      netns?: string;
      connect_timeout?: Duration;
      tcp_fast_open?: boolean;
      tcp_multi_path?: boolean;
      disable_tcp_keep_alive?: boolean;
      tcp_keep_alive?: Duration;
      tcp_keep_alive_interval?: Duration;
      udp_fragment?: boolean;
      domain_resolver?: DomainResolver;
      network_strategy?: "default" | "fallback" | "hybrid";
      network_type?: InterfaceType | InterfaceType[];
      fallback_network_type?: InterfaceType | InterfaceType[];
      fallback_delay?: Duration;
      server?: string;
      server_port?: number;
      username?: string;
      password?: string;
      tls?: OutboundTLSOptions;
      path?: string;
      headers?: HTTPHeader;
    }
  | {
      type: "hysteria";
      tag?: string;
      detour?: string;
      bind_interface?: string;
      inet4_bind_address?: string;
      inet6_bind_address?: string;
      bind_address_no_port?: boolean;
      protect_path?: string;
      routing_mark?: number | string;
      reuse_addr?: boolean;
      netns?: string;
      connect_timeout?: Duration;
      tcp_fast_open?: boolean;
      tcp_multi_path?: boolean;
      disable_tcp_keep_alive?: boolean;
      tcp_keep_alive?: Duration;
      tcp_keep_alive_interval?: Duration;
      udp_fragment?: boolean;
      domain_resolver?: DomainResolver;
      network_strategy?: "default" | "fallback" | "hybrid";
      network_type?: InterfaceType | InterfaceType[];
      fallback_network_type?: InterfaceType | InterfaceType[];
      fallback_delay?: Duration;
      server?: string;
      server_port?: number;
      server_ports?: string | string[];
      hop_interval?: Duration;
      up?: number | string;
      up_mbps?: number;
      down?: number | string;
      down_mbps?: number;
      obfs?: string;
      auth?: string | number[];
      auth_str?: string;
      network?: ("tcp" | "udp") | ("tcp" | "udp")[];
      tls?: OutboundTLSOptions;
      idle_timeout?: Duration;
      keep_alive_period?: Duration;
      stream_receive_window?: number | string;
      connection_receive_window?: number | string;
      max_concurrent_streams?: number;
      initial_packet_size?: number;
      disable_path_mtu_discovery?: boolean;
    }
  | {
      type: "hysteria2";
      tag?: string;
      detour?: string;
      bind_interface?: string;
      inet4_bind_address?: string;
      inet6_bind_address?: string;
      bind_address_no_port?: boolean;
      protect_path?: string;
      routing_mark?: number | string;
      reuse_addr?: boolean;
      netns?: string;
      connect_timeout?: Duration;
      tcp_fast_open?: boolean;
      tcp_multi_path?: boolean;
      disable_tcp_keep_alive?: boolean;
      tcp_keep_alive?: Duration;
      tcp_keep_alive_interval?: Duration;
      udp_fragment?: boolean;
      domain_resolver?: DomainResolver;
      network_strategy?: "default" | "fallback" | "hybrid";
      network_type?: InterfaceType | InterfaceType[];
      fallback_network_type?: InterfaceType | InterfaceType[];
      fallback_delay?: Duration;
      server?: string;
      server_port?: number;
      server_ports?: string | string[];
      hop_interval?: Duration;
      hop_interval_max?: Duration;
      up_mbps?: number;
      down_mbps?: number;
      obfs?:
        | {
            type: "salamander";
            password?: string;
          }
        | {
            type: "gecko";
            password?: string;
            min_packet_size?: number;
            max_packet_size?: number;
          };
      password?: string;
      network?: ("tcp" | "udp") | ("tcp" | "udp")[];
      tls?: OutboundTLSOptions;
      idle_timeout?: Duration;
      keep_alive_period?: Duration;
      stream_receive_window?: number | string;
      connection_receive_window?: number | string;
      max_concurrent_streams?: number;
      initial_packet_size?: number;
      disable_path_mtu_discovery?: boolean;
      bbr_profile?: "standard" | "conservative" | "aggressive";
      brutal_debug?: boolean;
      disable_chrome_parrot?: boolean;
      realm?: Hysteria2Realm;
    }
  | {
      type: "shadowsocks";
      tag?: string;
      detour?: string;
      bind_interface?: string;
      inet4_bind_address?: string;
      inet6_bind_address?: string;
      bind_address_no_port?: boolean;
      protect_path?: string;
      routing_mark?: number | string;
      reuse_addr?: boolean;
      netns?: string;
      connect_timeout?: Duration;
      tcp_fast_open?: boolean;
      tcp_multi_path?: boolean;
      disable_tcp_keep_alive?: boolean;
      tcp_keep_alive?: Duration;
      tcp_keep_alive_interval?: Duration;
      udp_fragment?: boolean;
      domain_resolver?: DomainResolver;
      network_strategy?: "default" | "fallback" | "hybrid";
      network_type?: InterfaceType | InterfaceType[];
      fallback_network_type?: InterfaceType | InterfaceType[];
      fallback_delay?: Duration;
      server?: string;
      server_port?: number;
      method?:
        | "none"
        | "aes-128-gcm"
        | "aes-192-gcm"
        | "aes-256-gcm"
        | "chacha20-ietf-poly1305"
        | "xchacha20-ietf-poly1305"
        | "2022-blake3-aes-128-gcm"
        | "2022-blake3-aes-256-gcm"
        | "2022-blake3-chacha20-poly1305"
        | "aes-128-ctr"
        | "aes-192-ctr"
        | "aes-256-ctr"
        | "aes-128-cfb"
        | "aes-192-cfb"
        | "aes-256-cfb"
        | "rc4-md5"
        | "chacha20-ietf"
        | "xchacha20";
      password?: string;
      plugin?: string;
      plugin_opts?: string;
      network?: ("tcp" | "udp") | ("tcp" | "udp")[];
      udp_over_tcp?:
        | boolean
        | {
            enabled?: boolean;
            version?: 1 | 2;
          };
      multiplex?: OutboundMultiplexOptions;
    }
  | {
      type: "shadowtls";
      tag?: string;
      detour?: string;
      bind_interface?: string;
      inet4_bind_address?: string;
      inet6_bind_address?: string;
      bind_address_no_port?: boolean;
      protect_path?: string;
      routing_mark?: number | string;
      reuse_addr?: boolean;
      netns?: string;
      connect_timeout?: Duration;
      tcp_fast_open?: boolean;
      tcp_multi_path?: boolean;
      disable_tcp_keep_alive?: boolean;
      tcp_keep_alive?: Duration;
      tcp_keep_alive_interval?: Duration;
      udp_fragment?: boolean;
      domain_resolver?: DomainResolver;
      network_strategy?: "default" | "fallback" | "hybrid";
      network_type?: InterfaceType | InterfaceType[];
      fallback_network_type?: InterfaceType | InterfaceType[];
      fallback_delay?: Duration;
      server?: string;
      server_port?: number;
      version?: 1 | 2 | 3;
      password?: string;
      tls?: OutboundTLSOptions;
    }
  | {
      type: "socks";
      tag?: string;
      detour?: string;
      bind_interface?: string;
      inet4_bind_address?: string;
      inet6_bind_address?: string;
      bind_address_no_port?: boolean;
      protect_path?: string;
      routing_mark?: number | string;
      reuse_addr?: boolean;
      netns?: string;
      connect_timeout?: Duration;
      tcp_fast_open?: boolean;
      tcp_multi_path?: boolean;
      disable_tcp_keep_alive?: boolean;
      tcp_keep_alive?: Duration;
      tcp_keep_alive_interval?: Duration;
      udp_fragment?: boolean;
      domain_resolver?: DomainResolver;
      network_strategy?: "default" | "fallback" | "hybrid";
      network_type?: InterfaceType | InterfaceType[];
      fallback_network_type?: InterfaceType | InterfaceType[];
      fallback_delay?: Duration;
      server?: string;
      server_port?: number;
      version?: "4" | "4a" | "5";
      username?: string;
      password?: string;
      network?: ("tcp" | "udp") | ("tcp" | "udp")[];
      udp_over_tcp?:
        | boolean
        | {
            enabled?: boolean;
            version?: 1 | 2;
          };
    }
  | {
      type: "ssh";
      tag?: string;
      detour?: string;
      bind_interface?: string;
      inet4_bind_address?: string;
      inet6_bind_address?: string;
      bind_address_no_port?: boolean;
      protect_path?: string;
      routing_mark?: number | string;
      reuse_addr?: boolean;
      netns?: string;
      connect_timeout?: Duration;
      tcp_fast_open?: boolean;
      tcp_multi_path?: boolean;
      disable_tcp_keep_alive?: boolean;
      tcp_keep_alive?: Duration;
      tcp_keep_alive_interval?: Duration;
      udp_fragment?: boolean;
      domain_resolver?: DomainResolver;
      network_strategy?: "default" | "fallback" | "hybrid";
      network_type?: InterfaceType | InterfaceType[];
      fallback_network_type?: InterfaceType | InterfaceType[];
      fallback_delay?: Duration;
      server?: string;
      server_port?: number;
      user?: string;
      password?: string;
      private_key?: string | string[];
      private_key_path?: string;
      private_key_passphrase?: string;
      host_key?: string | string[];
      host_key_algorithms?: string | string[];
      client_version?: string;
      cipher?: string | string[];
      mac?: string | string[];
      kex_algorithm?: string | string[];
    }
  | {
      type: "trojan";
      tag?: string;
      detour?: string;
      bind_interface?: string;
      inet4_bind_address?: string;
      inet6_bind_address?: string;
      bind_address_no_port?: boolean;
      protect_path?: string;
      routing_mark?: number | string;
      reuse_addr?: boolean;
      netns?: string;
      connect_timeout?: Duration;
      tcp_fast_open?: boolean;
      tcp_multi_path?: boolean;
      disable_tcp_keep_alive?: boolean;
      tcp_keep_alive?: Duration;
      tcp_keep_alive_interval?: Duration;
      udp_fragment?: boolean;
      domain_resolver?: DomainResolver;
      network_strategy?: "default" | "fallback" | "hybrid";
      network_type?: InterfaceType | InterfaceType[];
      fallback_network_type?: InterfaceType | InterfaceType[];
      fallback_delay?: Duration;
      server?: string;
      server_port?: number;
      password?: string;
      network?: ("tcp" | "udp") | ("tcp" | "udp")[];
      tls?: OutboundTLSOptions;
      multiplex?: OutboundMultiplexOptions;
      transport?: V2RayTransport;
    }
  | {
      type: "tuic";
      tag?: string;
      detour?: string;
      bind_interface?: string;
      inet4_bind_address?: string;
      inet6_bind_address?: string;
      bind_address_no_port?: boolean;
      protect_path?: string;
      routing_mark?: number | string;
      reuse_addr?: boolean;
      netns?: string;
      connect_timeout?: Duration;
      tcp_fast_open?: boolean;
      tcp_multi_path?: boolean;
      disable_tcp_keep_alive?: boolean;
      tcp_keep_alive?: Duration;
      tcp_keep_alive_interval?: Duration;
      udp_fragment?: boolean;
      domain_resolver?: DomainResolver;
      network_strategy?: "default" | "fallback" | "hybrid";
      network_type?: InterfaceType | InterfaceType[];
      fallback_network_type?: InterfaceType | InterfaceType[];
      fallback_delay?: Duration;
      server?: string;
      server_port?: number;
      uuid?: string;
      password?: string;
      congestion_control?: "cubic" | "new_reno" | "bbr";
      udp_relay_mode?: "native" | "quic";
      udp_over_stream?: boolean;
      zero_rtt_handshake?: boolean;
      heartbeat?: Duration;
      network?: ("tcp" | "udp") | ("tcp" | "udp")[];
      tls?: OutboundTLSOptions;
      idle_timeout?: Duration;
      keep_alive_period?: Duration;
      stream_receive_window?: number | string;
      connection_receive_window?: number | string;
      max_concurrent_streams?: number;
      initial_packet_size?: number;
      disable_path_mtu_discovery?: boolean;
    }
  | {
      type: "vless";
      tag?: string;
      detour?: string;
      bind_interface?: string;
      inet4_bind_address?: string;
      inet6_bind_address?: string;
      bind_address_no_port?: boolean;
      protect_path?: string;
      routing_mark?: number | string;
      reuse_addr?: boolean;
      netns?: string;
      connect_timeout?: Duration;
      tcp_fast_open?: boolean;
      tcp_multi_path?: boolean;
      disable_tcp_keep_alive?: boolean;
      tcp_keep_alive?: Duration;
      tcp_keep_alive_interval?: Duration;
      udp_fragment?: boolean;
      domain_resolver?: DomainResolver;
      network_strategy?: "default" | "fallback" | "hybrid";
      network_type?: InterfaceType | InterfaceType[];
      fallback_network_type?: InterfaceType | InterfaceType[];
      fallback_delay?: Duration;
      server?: string;
      server_port?: number;
      uuid?: string;
      flow?: string;
      network?: ("tcp" | "udp") | ("tcp" | "udp")[];
      tls?: OutboundTLSOptions;
      multiplex?: OutboundMultiplexOptions;
      transport?: V2RayTransport;
      packet_encoding?: string;
    }
  | {
      type: "vmess";
      tag?: string;
      detour?: string;
      bind_interface?: string;
      inet4_bind_address?: string;
      inet6_bind_address?: string;
      bind_address_no_port?: boolean;
      protect_path?: string;
      routing_mark?: number | string;
      reuse_addr?: boolean;
      netns?: string;
      connect_timeout?: Duration;
      tcp_fast_open?: boolean;
      tcp_multi_path?: boolean;
      disable_tcp_keep_alive?: boolean;
      tcp_keep_alive?: Duration;
      tcp_keep_alive_interval?: Duration;
      udp_fragment?: boolean;
      domain_resolver?: DomainResolver;
      network_strategy?: "default" | "fallback" | "hybrid";
      network_type?: InterfaceType | InterfaceType[];
      fallback_network_type?: InterfaceType | InterfaceType[];
      fallback_delay?: Duration;
      server?: string;
      server_port?: number;
      uuid?: string;
      security?: "auto" | "none" | "zero" | "aes-128-cfb" | "aes-128-gcm" | "chacha20-poly1305";
      alter_id?: number;
      global_padding?: boolean;
      authenticated_length?: boolean;
      network?: ("tcp" | "udp") | ("tcp" | "udp")[];
      tls?: OutboundTLSOptions;
      packet_encoding?: "packetaddr" | "xudp";
      multiplex?: OutboundMultiplexOptions;
      transport?: V2RayTransport;
    };
export type Duration = string;
export type DomainResolver =
  | string
  | {
      server: string;
      timeout?: Duration;
      strategy?: DomainStrategy;
      disable_cache?: boolean;
      disable_optimistic_cache?: boolean;
      rewrite_ttl?: number;
      client_subnet?: string;
    };
export type DomainStrategy = "" | "as_is" | "prefer_ipv4" | "prefer_ipv6" | "ipv4_only" | "ipv6_only";
export type InterfaceType = "cellular" | "ethernet" | "other" | "wifi";
export type HTTPClientReference =
  | string
  | {
      engine?: "go" | "apple";
      version?: 0 | 1 | 2 | 3;
      disable_version_fallback?: boolean;
      headers?: HTTPHeader;
      tls?: OutboundTLSOptions;
      detour?: string;
      bind_interface?: string;
      inet4_bind_address?: string;
      inet6_bind_address?: string;
      bind_address_no_port?: boolean;
      protect_path?: string;
      routing_mark?: number | string;
      reuse_addr?: boolean;
      netns?: string;
      connect_timeout?: Duration;
      tcp_fast_open?: boolean;
      tcp_multi_path?: boolean;
      disable_tcp_keep_alive?: boolean;
      tcp_keep_alive?: Duration;
      tcp_keep_alive_interval?: Duration;
      udp_fragment?: boolean;
      domain_resolver?: DomainResolver;
      network_strategy?: "default" | "fallback" | "hybrid";
      network_type?: InterfaceType | InterfaceType[];
      fallback_network_type?: InterfaceType | InterfaceType[];
      fallback_delay?: Duration;
      idle_timeout?: Duration;
      keep_alive_period?: Duration;
      stream_receive_window?: number | string;
      connection_receive_window?: number | string;
      max_concurrent_streams?: number;
      initial_packet_size?: number;
      disable_path_mtu_discovery?: boolean;
    };
export type V2RayTransport =
  | {
      type: "http";
      host?: string | string[];
      path?: string;
      method?: string;
      headers?: HTTPHeader;
      idle_timeout?: Duration;
      ping_timeout?: Duration;
    }
  | {
      type: "ws";
      path?: string;
      headers?: HTTPHeader;
      max_early_data?: number;
      early_data_header_name?: string;
    }
  | {
      type: "quic";
    }
  | {
      type: "grpc";
      service_name?: string;
      idle_timeout?: Duration;
      ping_timeout?: Duration;
      permit_without_stream?: boolean;
    }
  | {
      type: "httpupgrade";
      host?: string;
      path?: string;
      headers?: HTTPHeader;
    };

export interface OutboundTLSOptions {
  enabled?: boolean;
  engine?: "go" | "apple" | "windows";
  disable_sni?: boolean;
  server_name?: string;
  insecure?: boolean;
  alpn?: string | string[];
  min_version?: "1.0" | "1.1" | "1.2" | "1.3";
  max_version?: "1.0" | "1.1" | "1.2" | "1.3";
  cipher_suites?: string | string[];
  curve_preferences?:
    | ("P256" | "P384" | "P521" | "X25519" | "X25519MLKEM768")
    | ("P256" | "P384" | "P521" | "X25519" | "X25519MLKEM768")[];
  certificate?: string | string[];
  certificate_path?: string;
  certificate_public_key_sha256?: (string | number[]) | (string | number[])[];
  client_certificate?: string | string[];
  client_certificate_path?: string;
  client_key?: string | string[];
  client_key_path?: string;
  fragment?: boolean;
  fragment_fallback_delay?: Duration;
  record_fragment?: boolean;
  spoof?: string;
  spoof_method?: "wrong-sequence" | "wrong-checksum" | "wrong-ack" | "wrong-md5" | "wrong-timestamp";
  kernel_tx?: boolean;
  kernel_rx?: boolean;
  handshake_timeout?: Duration;
  ech?: OutboundECHOptions;
  utls?: OutboundUTLSOptions;
  reality?: OutboundRealityOptions;
}
export interface OutboundECHOptions {
  enabled?: boolean;
  config?: string | string[];
  config_path?: string;
  query_server_name?: string;
}
export interface OutboundUTLSOptions {
  enabled?: boolean;
  fingerprint?:
    | "chrome_psk"
    | "chrome_psk_shuffle"
    | "chrome_padding_psk_shuffle"
    | "chrome_pq"
    | "chrome_pq_psk"
    | "chrome"
    | "firefox"
    | "edge"
    | "safari"
    | "360"
    | "qq"
    | "ios"
    | "android"
    | "random"
    | "randomized";
}
export interface OutboundRealityOptions {
  enabled?: boolean;
  public_key?: string;
  short_id?: string;
}
export interface HTTPHeader {
  [k: string]: string | string[];
}
export interface Hysteria2Realm {
  server_url?: string;
  token?: string;
  realm_id?: string;
  stun_servers?: string | string[];
  ip_version?: 0 | 4 | 6;
  port_mapping?: Hysteria2RealmPortMapping;
  http_client?: HTTPClientReference;
}
export interface Hysteria2RealmPortMapping {
  enabled?: boolean;
  timeout?: Duration;
  lifetime?: Duration;
}
export interface OutboundMultiplexOptions {
  enabled?: boolean;
  protocol?: "h2mux" | "smux" | "yamux";
  max_connections?: number;
  min_streams?: number;
  max_streams?: number;
  padding?: boolean;
  brutal?: BrutalOptions;
}
export interface BrutalOptions {
  enabled?: boolean;
  up_mbps?: number;
  down_mbps?: number;
}
