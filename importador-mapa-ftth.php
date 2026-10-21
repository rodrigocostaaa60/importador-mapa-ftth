<?php
/**
 * Plugin Name: Importador do Mapa FTTH (JetEngine)
 * Description: Importação assistida de KML/KMZ para os CCTs de pontos e rotas do JetEngine.
 * Version: 0.10.21
 * Author: Inmov Agência
 * Requires PHP: 8.0
 * Update URI: https://github.com/rodrigocostaaa60/importador-mapa-ftth
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class Inmov_JetEngine_FTTH_Importer {
	const VERSION               = '0.10.21';
	const TRANSIENT_TTL         = 30 * MINUTE_IN_SECONDS;
	const UPDATE_CACHE_TTL      = 5 * MINUTE_IN_SECONDS;
	const UPDATE_FAILURE_TTL    = MINUTE_IN_SECONDS;
	const MAX_BYTES     = 20 * 1024 * 1024;
	const NONCE_ACTION  = 'inmov_ftth_import';

	private static $instance = null;

	public static function instance() {
		if ( null === self::$instance ) {
			self::$instance = new self();
		}
		return self::$instance;
	}

	private function __construct() {
		add_action( 'admin_menu', array( $this, 'register_menu' ) );
		add_action( 'admin_post_inmov_ftth_preview', array( $this, 'handle_preview' ) );
		add_action( 'admin_post_inmov_ftth_import', array( $this, 'handle_import' ) );
		add_action( 'rest_api_init', array( $this, 'register_routes_endpoint' ) );
		add_action( 'wp_enqueue_scripts', array( $this, 'enqueue_map_routes_layer' ) );
		add_action( 'wp_head', array( $this, 'print_map_loading_bootstrap' ), 1 );
		add_action( 'wp_print_footer_scripts', array( $this, 'order_native_map_scripts' ), 1 );
		add_filter( 'update_plugins_github.com', array( $this, 'filter_github_update' ), 10, 4 );
		add_filter( 'plugin_action_links_' . plugin_basename( __FILE__ ), array( $this, 'add_update_check_link' ) );
		add_action( 'admin_post_inmov_ftth_check_update', array( $this, 'handle_update_check' ) );
		add_action( 'admin_notices', array( $this, 'render_update_check_notice' ) );
	}

	/** Connect WordPress' native plugin updater to public GitHub Releases. */
	public function filter_github_update( $update, $plugin_data, $plugin_file, $locales ) {
		if ( plugin_basename( __FILE__ ) !== $plugin_file ) {
			return $update;
		}

		$release = get_transient( 'inmov_ftth_latest_github_release' );
		if ( false === $release ) {
			$release = $this->fetch_latest_github_release();
			set_transient(
				'inmov_ftth_latest_github_release',
				$release ?: array( 'none' => true ),
				$release ? self::UPDATE_CACHE_TTL : self::UPDATE_FAILURE_TTL
			);
		}

		if ( empty( $release ) || ! empty( $release['none'] ) ) {
			return $update;
		}

		$current_version = $plugin_data['Version'] ?? self::VERSION;
		if ( ! version_compare( $release['version'], $current_version, '>' ) ) {
			return $update;
		}

		return array(
			'id'          => $plugin_data['UpdateURI'] ?? 'https://github.com/rodrigocostaaa60/importador-mapa-ftth',
			'slug'        => dirname( $plugin_file ),
			'version'     => $release['version'],
			'url'         => $release['url'],
			'package'     => $release['package'],
			'requires_php'=> '8.0',
		);
	}

	/** Add a direct, nonce-protected release check to this plugin's row. */
	public function add_update_check_link( $links ) {
		$url = wp_nonce_url(
			admin_url( 'admin-post.php?action=inmov_ftth_check_update' ),
			'inmov_ftth_check_update'
		);
		array_unshift( $links, '<a href="' . esc_url( $url ) . '">' . esc_html__( 'Verificar atualização', 'inmov-ftth' ) . '</a>' );
		return $links;
	}

	/** Force a fresh GitHub lookup and WordPress plugin-update scan. */
	public function handle_update_check() {
		if ( ! current_user_can( 'update_plugins' ) ) {
			wp_die( esc_html__( 'Você não tem permissão para verificar atualizações.', 'inmov-ftth' ), 403 );
		}
		check_admin_referer( 'inmov_ftth_check_update' );

		delete_transient( 'inmov_ftth_latest_github_release' );
		delete_site_transient( 'update_plugins' );
		wp_update_plugins();

		wp_safe_redirect( add_query_arg( 'ftth_update_check', 'done', admin_url( 'plugins.php' ) ) );
		exit;
	}

	/** Confirm that the forced update scan completed. */
	public function render_update_check_notice() {
		if ( ! is_admin() || empty( $_GET['ftth_update_check'] ) || 'done' !== sanitize_key( wp_unslash( $_GET['ftth_update_check'] ) ) ) {
			return;
		}
		?>
		<div class="notice notice-info is-dismissible"><p><?php esc_html_e( 'Verificação concluída. Se houver uma nova release, ela aparecerá nesta lista.', 'inmov-ftth' ); ?></p></div>
		<?php
	}

	/** Read the latest stable release and its WordPress-ready ZIP asset. */
	private function fetch_latest_github_release() {
		$response = wp_remote_get(
			'https://api.github.com/repos/rodrigocostaaa60/importador-mapa-ftth/releases/latest',
			array(
				'timeout' => 8,
				'headers' => array(
					'Accept'     => 'application/vnd.github+json',
					'User-Agent' => 'Inmov-FTTH-Importer/' . self::VERSION,
				),
			)
		);

		if ( is_wp_error( $response ) || 200 !== wp_remote_retrieve_response_code( $response ) ) {
			return false;
		}

		$data = json_decode( wp_remote_retrieve_body( $response ), true );
		if ( empty( $data['tag_name'] ) || empty( $data['html_url'] ) || empty( $data['assets'] ) || ! is_array( $data['assets'] ) ) {
			return false;
		}

		$version = preg_replace( '/^v/i', '', sanitize_text_field( $data['tag_name'] ) );
		if ( ! preg_match( '/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/', $version ) ) {
			return false;
		}

		foreach ( $data['assets'] as $asset ) {
			if ( 'importador-mapa-ftth.zip' === ( $asset['name'] ?? '' ) && ! empty( $asset['browser_download_url'] ) ) {
				return array(
					'version' => $version,
					'url'     => esc_url_raw( $data['html_url'] ),
					'package' => esc_url_raw( $asset['browser_download_url'] ),
				);
			}
		}

		return false;
	}

	/** Register a read-only, authenticated GeoJSON endpoint for imported routes. */
	public function register_routes_endpoint() {
		register_rest_route(
			'inmov-ftth/v1',
			'/routes',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'permission_callback' => function() {
					return is_user_logged_in() && current_user_can( 'read' );
				},
				'callback'            => array( $this, 'get_routes_geojson' ),
			)
		);
		register_rest_route( 'inmov-ftth/v1', '/points', array(
			'methods' => WP_REST_Server::READABLE,
			'permission_callback' => function() { return is_user_logged_in() && current_user_can( 'read' ); },
			'callback' => array( $this, 'get_points' ),
		) );
	}

	public function get_points() {
		global $wpdb;
		$table = $wpdb->prefix . 'jet_cct_pontos_rede_ftth';
		$rows = $wpdb->get_results( "SELECT _ID, cct_author_id, cct_created, cct_modified, ponto_codigo, ponto_nome, ponto_tipo, ponto_localidade, ponto_endereco, ponto_latitude, ponto_longitude, ponto_status, ponto_capacidade_portas, ponto_observacao FROM {$table} WHERE cct_status = 'publish' AND ponto_status <> 'inativo' LIMIT 3000", ARRAY_A );
		return rest_ensure_response( array_map( function( $row ) {
			$saved_type = (string) $row['ponto_tipo'];
			$inferred_type = $this->detect_point_type( strtolower( remove_accents( (string) $row['ponto_nome'] . ' ' . (string) $row['ponto_observacao'] ) ) );
			$display_type = ( ( '' === $saved_type || 'outro' === $saved_type ) && 'outro' !== $inferred_type ) ? $inferred_type : $saved_type;
			$audit = $this->cct_audit_data( $row['cct_modified'] ?? '', $row['cct_created'] ?? '', $row['cct_author_id'] ?? 0 );
			return array(
			'id' => (int) $row['_ID'], 'code' => (string) $row['ponto_codigo'], 'name' => (string) $row['ponto_nome'],
			'type' => $display_type, 'locality' => (string) $row['ponto_localidade'], 'address' => (string) $row['ponto_endereco'],
			'lat' => (float) $row['ponto_latitude'], 'lng' => (float) $row['ponto_longitude'], 'status' => (string) $row['ponto_status'],
			'capacity' => (int) $row['ponto_capacidade_portas'], 'observation' => (string) $row['ponto_observacao'],
			'updatedAt' => $audit['date'], 'updatedBy' => $audit['user'],
		); }, $rows ) );
	}

	/** Format the CCT audit timestamp and creator without exposing database internals. */
	private function cct_audit_data( $modified, $created, $author_id ) {
		$value = $modified ?: $created;
		$timestamp = is_numeric( $value ) ? (int) $value : ( $value ? strtotime( (string) $value ) : 0 );
		$date = $timestamp ? wp_date( 'd/m/Y H:i', $timestamp, wp_timezone() ) : '';
		$user = '';
		$user_data = get_userdata( (int) $author_id );
		if ( $user_data ) {
			$user = $user_data->display_name ?: $user_data->user_login;
		}
		return array( 'date' => $date, 'user' => $user );
	}

	/** Return active route geometries as a bounded GeoJSON FeatureCollection. */
	public function get_routes_geojson() {
		global $wpdb;

		$table = $wpdb->prefix . 'jet_cct_rotas_fibra';
		$found = $wpdb->get_var( $wpdb->prepare( 'SHOW TABLES LIKE %s', $wpdb->esc_like( $table ) ) );
		if ( $table !== $found ) {
			return new WP_Error( 'inmov_ftth_routes_unavailable', 'A base de rotas do JetEngine não está disponível.', array( 'status' => 503 ) );
		}

		$sql = $wpdb->prepare(
			"SELECT _ID, cct_author_id, cct_created, cct_modified, rota_nome, rota_localidade, rota_tipo, rota_tipo_cabo, rota_quantidade_fibras, rota_status, rota_cor_mapa, rota_comprimento_metros, rota_geometria_geojson
			FROM {$table}
			WHERE cct_status = %s AND rota_status IN (%s, %s, %s)
			ORDER BY _ID ASC LIMIT 3000",
			'publish', 'nativa', 'em_implantacao', 'manutencao'
		);
		$rows = $wpdb->get_results( $sql, ARRAY_A );
		$features = array();
		$vertex_count = 0;

		foreach ( $rows as $row ) {
			$geometry = json_decode( $row['rota_geometria_geojson'], true );
			if ( ! is_array( $geometry ) || 'LineString' !== ( $geometry['type'] ?? '' ) || empty( $geometry['coordinates'] ) ) {
				continue;
			}

			$coordinates = array();
			foreach ( $geometry['coordinates'] as $coordinate ) {
				if ( ! is_array( $coordinate ) || count( $coordinate ) < 2 ) {
					continue;
				}
				$lng = (float) $coordinate[0];
				$lat = (float) $coordinate[1];
				if ( ! is_finite( $lng ) || ! is_finite( $lat ) || abs( $lng ) > 180 || abs( $lat ) > 90 ) {
					continue;
				}
				$coordinates[] = array( $lng, $lat );
			}

			if ( count( $coordinates ) < 2 ) {
				continue;
			}
			$vertex_count += count( $coordinates );
			if ( $vertex_count > 100000 ) {
				break;
			}

			$color = sanitize_hex_color( $row['rota_cor_mapa'] );
			$audit = $this->cct_audit_data( $row['cct_modified'] ?? '', $row['cct_created'] ?? '', $row['cct_author_id'] ?? 0 );
			$features[] = array(
				'type'       => 'Feature',
				'id'         => (int) $row['_ID'],
				'geometry'   => array( 'type' => 'LineString', 'coordinates' => $coordinates ),
				'properties' => array(
					'name'        => (string) $row['rota_nome'],
					'locality'    => (string) $row['rota_localidade'],
					'routeType'   => (string) $row['rota_tipo'],
					'cableType'   => (string) $row['rota_tipo_cabo'],
					'fibers'      => (int) $row['rota_quantidade_fibras'],
					'status'      => (string) $row['rota_status'],
					'lengthM'     => (int) $row['rota_comprimento_metros'],
					'updatedAt'   => $audit['date'],
					'updatedBy'   => $audit['user'],
					'color'       => $color ?: '#f97316',
				),
			);
		}

		$response = rest_ensure_response( array( 'type' => 'FeatureCollection', 'features' => $features ) );
		$response->header( 'Cache-Control', 'private, no-store, no-cache, must-revalidate, max-age=0' );
		return $response;
	}

	/** Declare the provider dependency before WordPress prints the native map scripts. */
	public function order_native_map_scripts() {
		if ( ! is_page( 3600 ) && ! is_page( 'mapa-da-rede-ftth' ) ) {
			return;
		}
		$scripts = wp_scripts();
		foreach ( array( 'jet-mapbox', 'jet-mapbox-provider', 'jet-maps-listings' ) as $handle ) {
			if ( ! isset( $scripts->registered[ $handle ] ) ) {
				return;
			}
		}
		// JetEngine 3.8 registers these independently. Loading frontend-maps first
		// makes its asynchronous provider wait miss Elementor's frontend/init event.
		$scripts->registered['jet-mapbox-provider']->deps = array_unique( array_merge(
			$scripts->registered['jet-mapbox-provider']->deps, array( 'jet-mapbox' )
		) );
		$scripts->registered['jet-maps-listings']->deps = array_unique( array_merge(
			$scripts->registered['jet-maps-listings']->deps, array( 'jet-mapbox-provider' )
		) );
	}

	/** Add the route line layer to the existing JetEngine Mapbox map on the FTTH page. */
	public function enqueue_map_routes_layer() {
		if ( ! is_page( 3600 ) && ! is_page( 'mapa-da-rede-ftth' ) ) {
			return;
		}

		wp_enqueue_script(
			'inmov-ftth-routes-layer',
			plugin_dir_url( __FILE__ ) . 'assets/routes-layer.js',
			array( 'jquery', 'jet-maps-listings', 'jet-mapbox-provider' ),
			self::VERSION,
			true
		);
		wp_enqueue_style( 'inmov-ftth-point-controls', plugin_dir_url( __FILE__ ) . 'assets/point-controls.css', array(), self::VERSION );
		wp_localize_script(
			'inmov-ftth-routes-layer',
			'InmovFtthMapRoutes',
			array(
				'endpoint' => esc_url_raw( rest_url( 'inmov-ftth/v1/routes' ) ),
				'pointsEndpoint' => esc_url_raw( rest_url( 'inmov-ftth/v1/points' ) ),
				'editPopupSelector' => '',
				'nonce'    => wp_create_nonce( 'wp_rest' ),
			)
		);
	}

	/** Put the loading state in place before Elementor/JetEngine creates Mapbox. */
	public function print_map_loading_bootstrap() {
		if ( ! is_page( 3600 ) && ! is_page( 'mapa-da-rede-ftth' ) ) {
			return;
		}
		?>
		<script>
		(function () {
			'use strict';
			var selector = '.jet-map-listing.mapbox-provider';
			/* This overlay is created while the document is still being parsed, so
			 * the user sees an honest loading state before Elementor/JetEngine and
			 * Mapbox start painting their layers. */
			function ensurePageLoading() {
				if (!document.documentElement || document.getElementById('inmov-ftth-page-loading')) return;
				var overlay = document.createElement('div');
				overlay.id = 'inmov-ftth-page-loading';
				overlay.setAttribute('role', 'status');
				overlay.setAttribute('aria-live', 'polite');
				overlay.innerHTML = '<span class="inmov-ftth-page-loading__spinner" aria-hidden="true"></span><strong>Carregando mapa</strong><span class="inmov-ftth-page-loading__text">Preparando rotas e pontos…</span>';
				overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483000;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;background:#f8fafc;color:#0f172a;font:600 15px/1.35 Inter,system-ui,sans-serif;opacity:1;visibility:visible;transition:opacity .24s ease,visibility .24s ease;';
				var style = document.createElement('style');
				style.textContent = '#inmov-ftth-page-loading strong{font-size:18px}#inmov-ftth-page-loading .inmov-ftth-page-loading__text{color:#64748b;font-size:13px;font-weight:500}#inmov-ftth-page-loading .inmov-ftth-page-loading__spinner{width:28px;height:28px;border:3px solid #dbeafe;border-top-color:#2563eb;border-radius:50%;animation:inmov-ftth-page-loading-spin .72s linear infinite}@keyframes inmov-ftth-page-loading-spin{to{transform:rotate(360deg)}}#inmov-ftth-page-loading.is-hidden{opacity:0;visibility:hidden;pointer-events:none}';
				document.documentElement.appendChild(style);
				document.documentElement.appendChild(overlay);
				window.setTimeout(function () {
					if (overlay && overlay.classList && !overlay.classList.contains('is-hidden')) {
						overlay.classList.add('is-hidden');
						overlay.style.opacity = '0';
						overlay.style.visibility = 'hidden';
						overlay.style.pointerEvents = 'none';
					}
				}, 20000);
			}
			ensurePageLoading();
			function mount(root) {
				var nodes = [];
				if (root && root.matches && root.matches(selector)) nodes.push(root);
				if (root && root.querySelectorAll) Array.prototype.forEach.call(root.querySelectorAll(selector), function (node) { nodes.push(node); });
				nodes.forEach(function (container) {
					var host = container.parentNode || container;
					var pageOverlay = document.getElementById('inmov-ftth-page-loading');
					if (pageOverlay && host && pageOverlay.parentNode !== host && host.appendChild) {
						host.appendChild(pageOverlay);
						pageOverlay.style.position = 'absolute';
						pageOverlay.style.inset = '0';
						pageOverlay.style.zIndex = '9000';
						pageOverlay.style.borderRadius = 'inherit';
					}
					if (!host || !host.appendChild || (host.querySelector && host.querySelector('.inmov-ftth-map-loading'))) return;
					if (host.classList) host.classList.add('inmov-ftth-map-shell');
					var overlay = document.createElement('div');
					overlay.className = 'inmov-ftth-map-loading is-visible';
					overlay.setAttribute('role', 'status');
					overlay.setAttribute('aria-live', 'polite');
					overlay.innerHTML = '<span class="inmov-ftth-map-loading__spinner" aria-hidden="true"></span><span class="inmov-ftth-map-loading__text">Carregando mapa, rotas e pontos…</span>';
					host.appendChild(overlay);
				});
			}
			function start() {
				mount(document);
				if (window.MutationObserver && document.documentElement) {
					var observer = new MutationObserver(function (records) {
						records.forEach(function (record) {
							Array.prototype.forEach.call(record.addedNodes || [], function (node) { if (node.nodeType === 1) mount(node); });
						});
					});
					observer.observe(document.documentElement, { childList: true, subtree: true });
					window.setTimeout(function () { observer.disconnect(); }, 20000);
				}
			}
			if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
			else start();
		}());
		</script>
		<?php
	}

	public function register_menu() {
		add_management_page(
			'Importador do Mapa FTTH',
			'Importador do Mapa FTTH',
			'manage_options',
			'inmov-ftth-importer',
			array( $this, 'render_page' )
		);
	}

	private function admin_url() {
		return admin_url( 'tools.php?page=inmov-ftth-importer' );
	}

	private function redirect_notice( $code ) {
		wp_safe_redirect( add_query_arg( 'ftth_notice', sanitize_key( $code ), $this->admin_url() ) );
		exit;
	}

	private function require_admin_request( $action ) {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( esc_html__( 'Você não tem permissão para executar esta ação.', 'inmov-ftth' ), 403 );
		}
		check_admin_referer( self::NONCE_ACTION . '_' . $action );
		if ( ! class_exists( '\Jet_Engine\Modules\Custom_Content_Types\Module' ) ) {
			wp_die( esc_html__( 'O módulo Custom Content Types do JetEngine precisa estar ativo.', 'inmov-ftth' ), 503 );
		}
	}

	public function handle_preview() {
		$this->require_admin_request( 'preview' );
		if ( empty( $_FILES['ftth_file']['tmp_name'] ) || UPLOAD_ERR_OK !== (int) $_FILES['ftth_file']['error'] ) {
			$this->redirect_notice( 'upload_error' );
		}

		$file = $_FILES['ftth_file'];
		if ( (int) $file['size'] < 1 || (int) $file['size'] > self::MAX_BYTES ) {
			$this->redirect_notice( 'size_error' );
		}

		$name   = sanitize_file_name( wp_unslash( $file['name'] ) );
		$ext    = strtolower( pathinfo( $name, PATHINFO_EXTENSION ) );
		$format = in_array( $ext, array( 'kml', 'kmz' ), true ) ? $ext : '';
		if ( ! $format ) {
			$this->redirect_notice( 'format_error' );
		}

		$contents = $this->read_uploaded_map( $file['tmp_name'], $format );
		if ( is_wp_error( $contents ) ) {
			$this->redirect_notice( $contents->get_error_code() );
		}

		$parsed = $this->parse_kml( $contents, $name );
		if ( is_wp_error( $parsed ) ) {
			$this->redirect_notice( $parsed->get_error_code() );
		}

		$locality_default = isset( $_POST['localidade_padrao'] ) ? sanitize_text_field( wp_unslash( $_POST['localidade_padrao'] ) ) : '';
		foreach ( $parsed['records'] as &$record ) {
			if ( empty( $record['locality'] ) && $locality_default ) {
				$record['locality'] = $locality_default;
				$record['locality_source'] = 'fallback';
			}
		}
		unset( $record );

		$parsed['file_name'] = $name;
		$parsed['format'] = $format;
		$parsed['file_hash'] = hash( 'sha256', $contents );
		$parsed['fallback_locality'] = $locality_default;
		$parsed['created_at'] = time();
		$parsed = $this->annotate_duplicates( $parsed );

		$token = wp_generate_password( 32, false, false );
		set_transient( $this->transient_key( $token ), $parsed, self::TRANSIENT_TTL );
		wp_safe_redirect( add_query_arg( array( 'ftth_preview' => rawurlencode( $token ) ), $this->admin_url() ) );
		exit;
	}

	private function read_uploaded_map( $path, $format ) {
		if ( 'kml' === $format ) {
			$data = file_get_contents( $path ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents
		} else {
			if ( ! class_exists( 'ZipArchive' ) ) {
				return new WP_Error( 'zip_unavailable' );
			}
			$zip = new ZipArchive();
			if ( true !== $zip->open( $path ) ) {
				return new WP_Error( 'kmz_invalid' );
			}
			$data = false;
			for ( $i = 0; $i < $zip->numFiles; $i++ ) {
				$stat = $zip->statIndex( $i );
				if ( ! empty( $stat['name'] ) && preg_match( '/\.kml$/i', $stat['name'] ) && (int) $stat['size'] <= self::MAX_BYTES ) {
					$data = $zip->getFromIndex( $i );
					break;
				}
			}
			$zip->close();
		}

		if ( ! is_string( $data ) || '' === trim( $data ) || strlen( $data ) > self::MAX_BYTES ) {
			return new WP_Error( 'kml_invalid' );
		}
		return $data;
	}

	private function parse_kml( $xml, $file_name ) {
		$previous = libxml_use_internal_errors( true );
		$dom = new DOMDocument();
		$ok = $dom->loadXML( $xml, LIBXML_NONET | LIBXML_NOBLANKS | LIBXML_COMPACT );
		libxml_clear_errors();
		libxml_use_internal_errors( $previous );
		if ( ! $ok ) {
			return new WP_Error( 'kml_invalid' );
		}

		$xpath = new DOMXPath( $dom );
		$placemarks = $xpath->query( '//*[local-name()="Placemark"]' );
		if ( ! $placemarks || 0 === $placemarks->length ) {
			return new WP_Error( 'no_placemarks' );
		}

		$records = array();
		$unsupported = 0;
		$feature_index = 0;
		foreach ( $placemarks as $placemark ) {
			$feature_index++;
			$name = $this->child_text( $xpath, $placemark, './*[local-name()="name"]' );
			$description = $this->child_text( $xpath, $placemark, './*[local-name()="description"]' );
			$kml_id = $placemark instanceof DOMElement ? $placemark->getAttribute( 'id' ) : '';
			$folder_path = $this->folder_path( $xpath, $placemark );
			$extended = $this->extended_data( $xpath, $placemark );
			$context = strtolower( remove_accents( $folder_path . ' ' . $name . ' ' . wp_strip_all_tags( $description ) ) );
			$locality = $this->detect_locality( $folder_path, $file_name );
			$geometry_index = 0;

			$points = $xpath->query( './/*[local-name()="Point"]', $placemark );
			foreach ( $points as $point ) {
				$geometry_index++;
				$raw = $this->child_text( $xpath, $point, './*[local-name()="coordinates"]' );
				$coords = $this->parse_coordinates( $raw );
				if ( empty( $coords ) ) {
					$records[] = $this->invalid_record( 'point', $name, $folder_path, 'Coordenadas de ponto ausentes ou inválidas.' );
					continue;
				}
				$coordinate = $coords[0];
				$type = $this->detect_point_type( $context );
				$source_key = $this->source_key( $file_name, $kml_id, $folder_path, $name, $feature_index . ':' . $geometry_index, 'point', $coordinate );
				$geom_hash = hash( 'sha256', 'point|' . number_format( $coordinate[1], 6, '.', '' ) . '|' . number_format( $coordinate[0], 6, '.', '' ) );
				$records[] = array(
					'kind' => 'point', 'name' => $name ?: 'Ponto sem nome #' . $feature_index,
					'locality' => $locality, 'locality_source' => $locality ? 'kml_or_filename' : '',
					'folder' => $folder_path, 'description' => $description, 'extended' => $extended,
					'kml_id' => $kml_id, 'point_type' => $type, 'coordinates' => $coordinate,
					'source_key' => $source_key, 'geometry_hash' => $geom_hash, 'valid' => true,
				);
			}

			$lines = $xpath->query( './/*[local-name()="LineString"]', $placemark );
			foreach ( $lines as $line ) {
				$geometry_index++;
				$raw = $this->child_text( $xpath, $line, './*[local-name()="coordinates"]' );
				$coords = $this->parse_coordinates( $raw );
				if ( count( $coords ) < 2 ) {
					$records[] = $this->invalid_record( 'line', $name, $folder_path, 'Linha precisa conter ao menos duas coordenadas válidas.' );
					continue;
				}
				$route_type = $this->detect_route_type( $context );
				$source_key = $this->source_key( $file_name, $kml_id, $folder_path, $name, $feature_index . ':' . $geometry_index, 'line', $coords );
				$canonical = $coords;
				$reverse = array_reverse( $coords );
				if ( wp_json_encode( $reverse ) < wp_json_encode( $canonical ) ) {
					$canonical = $reverse;
				}
				$geom_hash = hash( 'sha256', 'line|' . wp_json_encode( array_map( array( $this, 'rounded_coordinate' ), $canonical ) ) );
				$records[] = array(
					'kind' => 'line', 'name' => $name ?: 'Trecho sem nome #' . $feature_index,
					'locality' => $locality, 'locality_source' => $locality ? 'kml_or_filename' : '',
					'folder' => $folder_path, 'description' => $description, 'extended' => $extended,
					'kml_id' => $kml_id, 'route_type' => $route_type, 'coordinates' => $coords,
					'fiber_count' => $this->detect_fiber_count( $context ), 'cable_type' => $this->detect_cable_type( $context ),
					'length_m' => $this->line_length( $coords ), 'source_key' => $source_key,
					'geometry_hash' => $geom_hash, 'valid' => true,
				);
			}

			$polygons = $xpath->query( './/*[local-name()="Polygon"]', $placemark );
			if ( $polygons && $polygons->length ) {
				$unsupported += $polygons->length;
				foreach ( $polygons as $polygon ) {
					$records[] = $this->invalid_record( 'unsupported', $name, $folder_path, 'Polígono detectado: requer definição de camada/área antes da importação.' );
				}
			}
		}

		return array( 'records' => $records, 'unsupported' => $unsupported );
	}

	private function child_text( $xpath, $node, $query ) {
		$items = $xpath->query( $query, $node );
		return ( $items && $items->length ) ? trim( $items->item( 0 )->textContent ) : '';
	}

	private function folder_path( $xpath, $node ) {
		$parts = array();
		$parent = $node->parentNode;
		while ( $parent ) {
			if ( $parent instanceof DOMElement && 'Folder' === $parent->localName ) {
				$title = $this->child_text( $xpath, $parent, './*[local-name()="name"]' );
				if ( $title ) {
					array_unshift( $parts, $title );
				}
			}
			$parent = $parent->parentNode;
		}
		return implode( ' / ', $parts );
	}

	private function extended_data( $xpath, $node ) {
		$out = array();
		$items = $xpath->query( './/*[local-name()="Data"]', $node );
		foreach ( $items as $item ) {
			$key = $item instanceof DOMElement ? $item->getAttribute( 'name' ) : '';
			$value = $this->child_text( $xpath, $item, './*[local-name()="value"]' );
			if ( $key ) {
				$out[ sanitize_text_field( $key ) ] = sanitize_text_field( $value );
			}
		}
		$items = $xpath->query( './/*[local-name()="SimpleData"]', $node );
		foreach ( $items as $item ) {
			$key = $item instanceof DOMElement ? $item->getAttribute( 'name' ) : '';
			if ( $key ) {
				$out[ sanitize_text_field( $key ) ] = sanitize_text_field( $item->textContent );
			}
		}
		return $out;
	}

	private function parse_coordinates( $raw ) {
		$result = array();
		foreach ( preg_split( '/\s+/', trim( $raw ) ) as $tuple ) {
			if ( '' === $tuple ) {
				continue;
			}
			$parts = explode( ',', trim( $tuple ) );
			if ( count( $parts ) < 2 || ! is_numeric( $parts[0] ) || ! is_numeric( $parts[1] ) ) {
				continue;
			}
			$lon = (float) $parts[0];
			$lat = (float) $parts[1];
			if ( $lon < -180 || $lon > 180 || $lat < -90 || $lat > 90 ) {
				continue;
			}
			$result[] = array( $lon, $lat );
		}
		return $result;
	}

	public function rounded_coordinate( $coordinate ) {
		return array( round( (float) $coordinate[0], 6 ), round( (float) $coordinate[1], 6 ) );
	}

	private function detect_locality( $folder_path, $file_name ) {
		$folder_text = strtolower( remove_accents( $folder_path ) );
		$file_text = strtolower( remove_accents( pathinfo( $file_name, PATHINFO_FILENAME ) ) );
		if ( false !== strpos( $file_text, 'doc-20250818-wa0017' ) ) return 'Cravolândia';
		if ( false !== strpos( $file_text, 'doc-20250818-wa0022' ) ) return 'Mutuípe';
		$places = array(
			'cravolandia' => 'Cravolândia', 'mutuipe' => 'Mutuípe', 'jaguaquara' => 'Jaguaquara',
			'jequie' => 'Jequié', 'sao miguel das matas' => 'São Miguel das Matas',
		);
		foreach ( $places as $needle => $label ) {
			if ( $folder_text && false !== strpos( $folder_text, $needle ) ) {
				return $label;
			}
		}
		if ( preg_match( '/jequie\s*x\s*jaguaquara|jaguaquara\s*x\s*jequie/', $file_text ) ) return 'Jequié / Jaguaquara';
		foreach ( $places as $needle => $label ) {
			if ( false !== strpos( $file_text, $needle ) ) return $label;
		}
		return '';
	}

	private function detect_point_type( $text ) {
		$text = strtolower( remove_accents( (string) $text ) );
		if ( preg_match( '/\b(olt)\b/', $text ) ) return 'olt';
		if ( preg_match( '/\b(pop)\b/', $text ) ) {
			return ( false !== strpos( $text, 'olt' ) ) ? 'olt' : 'pop';
		}
		// CTOs and CTs are frequently exported with engineering codes such as
		// "CT 05.01.02" or "CT.01.01.01" instead of the full CTO label.
		if ( preg_match( '/\bcto\b|\bcep(?:\s*[.\/_-]?\s*\d[\d.\/_-]*)?\b|\bct(?:\s*[.\/_-]?\s*\d[\d.\/_-]*)?\b/', $text ) ) return 'cto';
		// CEO PON and optical splice-box nomenclature identify a caixa de emenda.
		if ( preg_match( '/\bceo\b|\bcaixa\s+(?:optica|de\s+emenda)|\b(?:cx|caixa)\s+(?:optica\s+)?(?:de\s+)?emenda\b/', $text ) ) return 'caixa_emenda';
		if ( preg_match( '/\bposte(s)?\b/', $text ) ) return 'poste';
		if ( preg_match( '/\bsplitter\b/', $text ) ) return 'splitter';
		if ( preg_match( '/\bcaixa(?:\s*[.\/_-]?\s*\d[\d.\/_-]*)?\b/', $text ) ) return 'cto';
		if ( preg_match( '/\bloja\b|\bsede\b|\bescritorio\b/', $text ) ) return 'loja';
		return 'outro';
	}

	private function detect_route_type( $text ) {
		if ( preg_match( '/\b(?:asu|cfoa\s*[-_ ]?sm\s*[-_ ]?as\d+)\b/', $text ) ) return 'asu';
		if ( preg_match( '/\b(backbone|bkb)\b/', $text ) ) return 'backbone';
		if ( preg_match( '/\b(alimentacao|alimentador|feeder)\b/', $text ) ) return 'alimentacao';
		if ( preg_match( '/\b(distribuicao|distribution)\b/', $text ) ) return 'distribuicao';
		if ( preg_match( '/\b(drop|ramal)\b/', $text ) ) return 'drop';
		return 'outro';
	}

	private function detect_fiber_count( $text ) {
		if ( preg_match( '/\b(?:fo\s*)?(\d{1,3})\s*(?:fibras?|fo)\b/', $text, $match ) ) return (int) $match[1];
		if ( preg_match( '/(?:^|[^a-z])0*(\d{1,3})\s*fo\b/i', $text, $match ) ) return (int) $match[1];
		if ( preg_match( '/(?:s|-)0*(\d{1,3})\s*fo\b/i', $text, $match ) ) return (int) $match[1];
		if ( preg_match( '/\b(\d{1,3})\s*f\b/', $text, $match ) ) return (int) $match[1];
		return 0;
	}

	private function detect_cable_type( $text ) {
		if ( preg_match( '/\b(?:cfoa|cfoi|fo|fibra optica|fibra óptica)[\s\-]*([a-z0-9\- ]{0,18})/i', $text, $match ) ) {
			return sanitize_text_field( trim( $match[0] ) );
		}
		return '';
	}

	private function line_length( $coords ) {
		$meters = 0.0;
		for ( $i = 1; $i < count( $coords ); $i++ ) {
			$lat1 = deg2rad( $coords[ $i - 1 ][1] );
			$lat2 = deg2rad( $coords[ $i ][1] );
			$dlat = $lat2 - $lat1;
			$dlon = deg2rad( $coords[ $i ][0] - $coords[ $i - 1 ][0] );
			$a = sin( $dlat / 2 ) ** 2 + cos( $lat1 ) * cos( $lat2 ) * sin( $dlon / 2 ) ** 2;
			$meters += 6371000 * 2 * atan2( sqrt( $a ), sqrt( 1 - $a ) );
		}
		return (int) round( $meters );
	}

	private function source_key( $file_name, $kml_id, $folder, $name, $index, $type, $coords ) {
		$identity = $kml_id ? 'id:' . $kml_id . '|' . $type : 'path:' . $folder . '|' . $name . '|' . $type;
		return sanitize_file_name( pathinfo( $file_name, PATHINFO_FILENAME ) ) . ':' . substr( hash( 'sha256', $identity . '|' . $index ), 0, 32 );
	}

	private function invalid_record( $kind, $name, $folder, $error ) {
		return array( 'kind' => $kind, 'name' => $name, 'folder' => $folder, 'valid' => false, 'error' => $error, 'selected' => false );
	}

	private function cct_type( $slug ) {
		return \Jet_Engine\Modules\Custom_Content_Types\Module::instance()->manager->get_content_types( $slug );
	}

	private function find_existing( $slug, $field, $value ) {
		$type = $this->cct_type( $slug );
		if ( ! $type || ! $value ) return false;
		$args = $type->prepare_query_args( array( array( 'field' => $field, 'operator' => '=', 'value' => $value ) ) );
		$items = $type->db->query( $args, 1, 0 );
		return ! empty( $items );
	}

	private function annotate_duplicates( $parsed ) {
		$seen_keys = array();
		$seen_hashes = array();
		foreach ( $parsed['records'] as &$record ) {
			if ( empty( $record['valid'] ) ) continue;
			$record['selected'] = true;
			$record['warnings'] = array();
			$slug = 'point' === $record['kind'] ? 'pontos_rede_ftth' : 'rotas_fibra';
			$prefix = 'point' === $record['kind'] ? 'ponto' : 'rota';
			if ( $this->find_existing( $slug, $prefix . '_chave_origem', $record['source_key'] ) ) {
				$record['existing'] = 'same_source';
				$record['selected'] = false;
			} elseif ( isset( $seen_keys[ $record['source_key'] ] ) ) {
				$record['existing'] = 'duplicate_in_file';
				$record['selected'] = false;
			} else {
				$seen_keys[ $record['source_key'] ] = true;
			}
			if ( $this->find_existing( $slug, $prefix . '_hash_geometria', $record['geometry_hash'] ) ) {
				$record['warnings'][] = 'Já existe geometria igual no sistema.';
				$record['selected'] = false;
			} elseif ( isset( $seen_hashes[ $slug . ':' . $record['geometry_hash'] ] ) ) {
				$record['warnings'][] = 'Geometria repetida dentro do arquivo.';
				$record['selected'] = false;
			} else {
				$seen_hashes[ $slug . ':' . $record['geometry_hash'] ] = true;
			}
			if ( empty( $record['locality'] ) ) {
				$record['selected'] = false;
			}
		}
		unset( $record );
		return $parsed;
	}

	private function transient_key( $token ) {
		return 'inmov_ftth_' . get_current_user_id() . '_' . preg_replace( '/[^a-zA-Z0-9]/', '', $token );
	}

	public function handle_import() {
		$this->require_admin_request( 'import' );
		$token = isset( $_POST['preview_token'] ) ? sanitize_text_field( wp_unslash( $_POST['preview_token'] ) ) : '';
		$parsed = get_transient( $this->transient_key( $token ) );
		if ( ! is_array( $parsed ) || empty( $parsed['records'] ) ) {
			$this->redirect_notice( 'preview_expired' );
		}

		$point_status = isset( $_POST['point_status'] ) ? sanitize_key( wp_unslash( $_POST['point_status'] ) ) : 'nativo';
		$route_status = isset( $_POST['route_status'] ) ? sanitize_key( wp_unslash( $_POST['route_status'] ) ) : 'nativa';
		if ( ! in_array( $point_status, array( 'planejado', 'em_implantacao', 'nativo', 'manutencao', 'inativo' ), true ) || ! in_array( $route_status, array( 'planejada', 'em_implantacao', 'nativa', 'manutencao', 'inativa' ), true ) ) {
			$this->redirect_notice( 'status_error' );
		}

		$selected = isset( $_POST['include'] ) && is_array( $_POST['include'] ) ? array_map( 'absint', wp_unslash( $_POST['include'] ) ) : array();
		$localities = isset( $_POST['locality'] ) && is_array( $_POST['locality'] ) ? array_map( 'sanitize_text_field', wp_unslash( $_POST['locality'] ) ) : array();
		$point_types = isset( $_POST['point_type'] ) && is_array( $_POST['point_type'] ) ? array_map( 'sanitize_key', wp_unslash( $_POST['point_type'] ) ) : array();
		$route_types = isset( $_POST['route_type'] ) && is_array( $_POST['route_type'] ) ? array_map( 'sanitize_key', wp_unslash( $_POST['route_type'] ) ) : array();
		$batch_id = $this->create_batch( $parsed );
		if ( is_wp_error( $batch_id ) ) {
			$this->redirect_notice( 'cct_error' );
		}

		$counts = array( 'point' => 0, 'line' => 0, 'errors' => 0, 'skipped' => 0, 'existing' => 0, 'duplicates' => 0 );
		$errors = array();
		$now = time();
		foreach ( $parsed['records'] as $index => $record ) {
			if ( empty( $record['valid'] ) ) {
				$counts['skipped']++;
				$counts['errors']++;
				$errors[] = ( $record['name'] ?: 'Geometria sem nome' ) . ': ' . ( $record['error'] ?? 'Elemento inválido ou não suportado.' );
				continue;
			}
			if ( ! in_array( $index, $selected, true ) ) {
				$counts['skipped']++;
				if ( 'same_source' === ( $record['existing'] ?? '' ) || 'duplicate_in_file' === ( $record['existing'] ?? '' ) ) $counts['existing']++;
				if ( ! empty( $record['warnings'] ) ) $counts['duplicates']++;
				continue;
			}
			$locality = isset( $localities[ $index ] ) ? sanitize_text_field( $localities[ $index ] ) : ( $record['locality'] ?? '' );
			if ( '' === $locality ) {
				$counts['errors']++;
				$errors[] = $record['name'] . ': localidade obrigatória ausente.';
				continue;
			}
			try {
				if ( 'point' === $record['kind'] ) {
					$point_type = $point_types[ $index ] ?? $record['point_type'];
					if ( ! in_array( $point_type, array( 'pop', 'olt', 'cto', 'poste', 'caixa_emenda', 'splitter', 'loja', 'outro' ), true ) ) throw new RuntimeException( 'Tipo de ponto inválido.' );
					// Loja/sede is a visual classification; keep the CCT value compatible
					// with existing JetEngine select options and infer it on the map feed.
					$point_type_storage = 'loja' === $point_type ? 'outro' : $point_type;
					if ( $this->find_existing( 'pontos_rede_ftth', 'ponto_chave_origem', $record['source_key'] ) ) {
						$counts['existing']++;
						$counts['skipped']++;
						continue;
					}
					if ( ! empty( $record['warnings'] ) ) $counts['duplicates']++;
					$data = array(
						'ponto_codigo' => 'IMP-P-' . strtoupper( substr( hash( 'sha256', $record['source_key'] ), 0, 10 ) ),
						'ponto_nome' => sanitize_text_field( $record['name'] ),
						'ponto_tipo' => $point_type_storage,
						'ponto_localidade' => $locality,
						'ponto_latitude' => (string) $record['coordinates'][1],
						'ponto_longitude' => (string) $record['coordinates'][0],
						'ponto_status' => $point_status,
						'ponto_chave_origem' => $record['source_key'],
						'ponto_hash_geometria' => $record['geometry_hash'],
						'ponto_origem_importacao' => $parsed['file_name'],
						'ponto_lote_importacao_id' => (int) $batch_id,
						'ponto_importado_em' => $now,
						'ponto_dados_origem' => $this->source_payload( $record ),
						'ponto_observacao' => 'Importado de KML/KMZ. Revise classificação, endereço e dados técnicos.',
					);
					$this->insert_cct( 'pontos_rede_ftth', $data );
					$counts['point']++;
				} else {
					$route_type = $route_types[ $index ] ?? $record['route_type'];
					if ( ! in_array( $route_type, array( 'backbone', 'asu', 'alimentacao', 'distribuicao', 'drop', 'outro' ), true ) ) throw new RuntimeException( 'Tipo de rota inválido.' );
					if ( $this->find_existing( 'rotas_fibra', 'rota_chave_origem', $record['source_key'] ) ) {
						$counts['existing']++;
						$counts['skipped']++;
						continue;
					}
					if ( ! empty( $record['warnings'] ) ) $counts['duplicates']++;
					$geojson = array( 'type' => 'LineString', 'coordinates' => $record['coordinates'] );
					$data = array(
						'rota_codigo' => 'IMP-R-' . strtoupper( substr( hash( 'sha256', $record['source_key'] ), 0, 10 ) ),
						'rota_nome' => sanitize_text_field( $record['name'] ),
						'rota_localidade' => $locality,
						'rota_tipo' => $route_type,
						'rota_tipo_cabo' => sanitize_text_field( $record['cable_type'] ),
						'rota_quantidade_fibras' => (int) $record['fiber_count'],
						'rota_status' => $route_status,
						'rota_geometria_geojson' => wp_json_encode( $geojson ),
						'rota_comprimento_metros' => (int) $record['length_m'],
						'rota_chave_origem' => $record['source_key'],
						'rota_hash_geometria' => $record['geometry_hash'],
						'rota_origem_importacao' => $parsed['file_name'],
						'rota_lote_importacao_id' => (int) $batch_id,
						'rota_importada_em' => $now,
						'rota_dados_origem' => $this->source_payload( $record ),
						'rota_observacao' => 'Importado de KML/KMZ. Revise classificação, comprimento e dados técnicos.',
					);
					$this->insert_cct( 'rotas_fibra', $data );
					$counts['line']++;
				}
			} catch ( Throwable $error ) {
				$counts['errors']++;
				$errors[] = $record['name'] . ': ' . $error->getMessage();
			}
		}

		$this->finish_batch( $batch_id, $parsed, $counts, $errors );
		delete_transient( $this->transient_key( $token ) );
		$this->redirect_notice( $counts['errors'] ? 'import_partial' : 'import_done' );
	}

	private function insert_cct( $slug, $data ) {
		$type = $this->cct_type( $slug );
		if ( ! $type ) throw new RuntimeException( 'CCT JetEngine não encontrado: ' . $slug );
		$id = $type->get_item_handler()->update_item( $data );
		if ( is_wp_error( $id ) || ! $id ) throw new RuntimeException( 'JetEngine não confirmou a gravação em ' . $slug . '.' );
		return (int) $id;
	}

	private function create_batch( $parsed ) {
		$now = time();
		$code = 'IMP-' . gmdate( 'Ymd-His', $now ) . '-' . strtoupper( wp_generate_password( 4, false, false ) );
		$data = array(
			'importacao_codigo' => $code,
			'importacao_arquivo_nome' => $parsed['file_name'],
			'importacao_formato' => $parsed['format'],
			'importacao_mapa_origem' => $parsed['fallback_locality'] ?: 'Detectada pelas pastas/nome do arquivo',
			'importacao_hash_arquivo' => $parsed['file_hash'],
			'importacao_status' => 'validando',
			'importacao_usuario_id' => get_current_user_id(),
			'importacao_iniciada_em' => $now,
			'importacao_total_elementos' => count( $parsed['records'] ),
			'importacao_novos' => 0,
			'importacao_ja_existentes' => 0,
			'importacao_com_duplicidade' => 0,
			'importacao_com_erro' => 0,
			'importacao_relatorio_erros' => '',
		);
		try {
			return $this->insert_cct( 'mapa_importacoes', $data );
		} catch ( Throwable $error ) {
			return new WP_Error( 'batch_create_failed', $error->getMessage() );
		}
	}

	private function finish_batch( $batch_id, $parsed, $counts, $errors ) {
		$type = $this->cct_type( 'mapa_importacoes' );
		if ( ! $type ) return;
		$data = array(
			'_ID' => (int) $batch_id,
			'importacao_status' => $counts['errors'] ? 'concluida_com_alertas' : 'concluida',
			'importacao_finalizada_em' => time(),
			'importacao_novos' => $counts['point'] + $counts['line'],
			'importacao_ja_existentes' => $counts['existing'],
			'importacao_com_duplicidade' => $counts['duplicates'],
			'importacao_com_erro' => $counts['errors'],
			'importacao_relatorio_erros' => sanitize_textarea_field( implode( "\n", array_slice( $errors, 0, 100 ) ) ),
		);
		$type->get_item_handler()->update_item( $data );
	}

	private function source_payload( $record ) {
		$payload = array(
			'placemark_name' => $record['name'], 'folder_path' => $record['folder'],
			'kml_id' => $record['kml_id'], 'description' => wp_strip_all_tags( $record['description'] ),
			'extended_data' => $record['extended'], 'coordinates' => $record['coordinates'],
		);
		return wp_json_encode( $payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES );
	}

	public function render_page() {
		if ( ! current_user_can( 'manage_options' ) ) return;
		$preview = '';
		$parsed = false;
		if ( isset( $_GET['ftth_preview'] ) ) {
			$preview = sanitize_text_field( wp_unslash( $_GET['ftth_preview'] ) );
			$parsed = get_transient( $this->transient_key( $preview ) );
		}
		?>
		<div class="wrap inmov-ftth-importer">
			<h1>Importador do Mapa FTTH</h1>
			<p>Envie um arquivo KML/KMZ para revisar os elementos antes de gravá-los nos CCTs do JetEngine. Nada é importado até a confirmação explícita.</p>
			<?php $this->render_notice(); ?>
			<?php if ( is_array( $parsed ) ) : $this->render_preview( $preview, $parsed ); else : $this->render_upload(); endif; ?>
		</div>
		<style>
		.inmov-ftth-importer{max-width:1280px}.inmov-ftth-importer .ftth-panel{background:#fff;border:1px solid #dcdcde;border-radius:8px;padding:20px;margin:18px 0}.inmov-ftth-importer .ftth-summary{display:flex;gap:12px;flex-wrap:wrap}.inmov-ftth-importer .ftth-stat{padding:12px 18px;background:#f6f7f7;border-radius:6px;min-width:125px}.inmov-ftth-importer .ftth-stat strong{display:block;font-size:22px}.inmov-ftth-importer .ftth-table-wrap{max-height:620px;overflow:auto;border:1px solid #dcdcde}.inmov-ftth-importer table{border-collapse:collapse;width:100%;background:#fff}.inmov-ftth-importer th,.inmov-ftth-importer td{padding:8px 10px;border-bottom:1px solid #eee;text-align:left;vertical-align:top}.inmov-ftth-importer th{position:sticky;top:0;background:#f6f7f7;z-index:1}.inmov-ftth-importer .ftth-warn{color:#8a4b00}.inmov-ftth-importer .ftth-error{color:#b32d2e}.inmov-ftth-importer .ftth-muted{color:#646970}.inmov-ftth-importer .ftth-controls{display:flex;gap:18px;align-items:end;flex-wrap:wrap}.inmov-ftth-importer .ftth-controls label{display:block;font-weight:600;margin-bottom:6px}.inmov-ftth-importer .ftth-locality{min-width:175px}
		</style>
		<?php
	}

	private function render_upload() {
		?>
		<div class="ftth-panel">
			<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" enctype="multipart/form-data">
				<input type="hidden" name="action" value="inmov_ftth_preview">
				<?php wp_nonce_field( self::NONCE_ACTION . '_preview' ); ?>
				<p><label for="ftth_file"><strong>Arquivo KML ou KMZ</strong></label><br><input id="ftth_file" name="ftth_file" type="file" accept=".kml,.kmz,application/vnd.google-earth.kml+xml,application/vnd.google-earth.kmz" required></p>
				<p><label for="localidade_padrao"><strong>Localidade padrão (opcional)</strong></label><br><input id="localidade_padrao" name="localidade_padrao" type="text" class="regular-text" placeholder="Usada somente quando não for detectada no KML" value=""></p>
				<p class="description">Tamanho máximo: 20 MB. A leitura é feita no servidor, sem carregar um mapa interativo no navegador.</p>
				<?php submit_button( 'Gerar prévia segura', 'primary', 'submit', false ); ?>
			</form>
		</div>
		<?php
	}

	private function render_preview( $token, $parsed ) {
		$valid_points = 0; $valid_lines = 0; $invalid = 0; $duplicates = 0; $no_locality = 0;
		foreach ( $parsed['records'] as $record ) {
			if ( empty( $record['valid'] ) ) { $invalid++; continue; }
			if ( 'point' === $record['kind'] ) $valid_points++; else $valid_lines++;
			if ( ! empty( $record['existing'] ) || ! empty( $record['warnings'] ) ) $duplicates++;
			if ( empty( $record['locality'] ) ) $no_locality++;
		}
		?>
		<div class="ftth-panel">
			<h2>Prévia: <?php echo esc_html( $parsed['file_name'] ); ?></h2>
			<p class="ftth-muted">A prévia expira em 30 minutos. Confirme apenas os elementos revisados.</p>
			<div class="ftth-summary">
				<div class="ftth-stat"><strong><?php echo esc_html( $valid_points ); ?></strong>Pontos</div>
				<div class="ftth-stat"><strong><?php echo esc_html( $valid_lines ); ?></strong>Rotas</div>
				<div class="ftth-stat"><strong><?php echo esc_html( $invalid ); ?></strong>Inválidos/áreas</div>
				<div class="ftth-stat"><strong><?php echo esc_html( $duplicates ); ?></strong>Possíveis duplicidades</div>
				<div class="ftth-stat"><strong><?php echo esc_html( $no_locality ); ?></strong>Sem localidade</div>
			</div>
		</div>
		<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
			<input type="hidden" name="action" value="inmov_ftth_import">
			<input type="hidden" name="preview_token" value="<?php echo esc_attr( $token ); ?>">
			<?php wp_nonce_field( self::NONCE_ACTION . '_import' ); ?>
			<div class="ftth-panel ftth-controls">
				<div><label for="point_status">Status padrão dos pontos</label><select id="point_status" name="point_status"><option value="nativo">Nativo</option><option value="planejado">Planejado</option><option value="em_implantacao">Em implantação</option><option value="manutencao">Manutenção</option><option value="inativo">Inativo</option></select></div>
				<div><label for="route_status">Status padrão das rotas</label><select id="route_status" name="route_status"><option value="nativa">Nativa</option><option value="planejada">Planejada</option><option value="em_implantacao">Em implantação</option><option value="manutencao">Manutenção</option><option value="inativa">Inativa</option></select></div>
				<div><button type="button" class="button" id="ftth-select-safe">Marcar itens sem alerta</button> <button type="button" class="button" id="ftth-select-all">Marcar todos válidos</button></div>
			</div>
			<div class="ftth-panel"><div class="ftth-table-wrap"><table>
				<thead><tr><th>Importar</th><th>Tipo</th><th>Nome / pasta</th><th>Localidade</th><th>Detalhes / validação</th></tr></thead><tbody>
				<?php foreach ( $parsed['records'] as $index => $record ) : ?>
				<tr>
					<td><?php if ( ! empty( $record['valid'] ) ) : ?><input type="checkbox" class="ftth-include" name="include[]" value="<?php echo esc_attr( $index ); ?>" <?php checked( ! empty( $record['selected'] ) ); ?> <?php disabled( 'same_source' === ( $record['existing'] ?? '' ) ); ?>><?php if ( 'same_source' === ( $record['existing'] ?? '' ) ) echo '<br><small>Já importado</small>'; ?><?php else : ?><span class="ftth-error">—</span><?php endif; ?></td>
					<td>
						<?php if ( 'point' === $record['kind'] ) : ?>
							Ponto<br><select name="point_type[<?php echo esc_attr( $index ); ?>]"><?php foreach ( array( 'pop' => 'POP', 'olt' => 'OLT', 'cto' => 'CTO', 'poste' => 'Poste', 'caixa_emenda' => 'Caixa de emenda', 'splitter' => 'Splitter', 'loja' => 'Loja / sede', 'outro' => 'Outro' ) as $value => $label ) : ?><option value="<?php echo esc_attr( $value ); ?>" <?php selected( $record['point_type'], $value ); ?>><?php echo esc_html( $label ); ?></option><?php endforeach; ?></select>
						<?php elseif ( 'line' === $record['kind'] ) : ?>
							Rota<br><select name="route_type[<?php echo esc_attr( $index ); ?>]"><?php foreach ( array( 'backbone' => 'Backbone', 'alimentacao' => 'Alimentação', 'distribuicao' => 'Distribuição', 'drop' => 'Drop', 'outro' => 'Outro' ) as $value => $label ) : ?><option value="<?php echo esc_attr( $value ); ?>" <?php selected( $record['route_type'], $value ); ?>><?php echo esc_html( $label ); ?></option><?php endforeach; ?></select>
						<?php else : ?>Área/erro<?php endif; ?>
					</td>
					<td><strong><?php echo esc_html( $record['name'] ?: '(sem nome)' ); ?></strong><br><small class="ftth-muted"><?php echo esc_html( $record['folder'] ); ?></small></td>
					<td><?php if ( ! empty( $record['valid'] ) ) : ?><input class="ftth-locality" type="text" name="locality[<?php echo esc_attr( $index ); ?>]" value="<?php echo esc_attr( $record['locality'] ?? '' ); ?>" placeholder="Localidade obrigatória"><?php endif; ?></td>
					<td>
						<?php if ( ! empty( $record['valid'] ) ) : ?>
							<?php if ( 'point' === $record['kind'] ) : ?>lat <?php echo esc_html( $record['coordinates'][1] ); ?>, lon <?php echo esc_html( $record['coordinates'][0] ); ?><?php else : ?><?php echo esc_html( count( $record['coordinates'] ) ); ?> vértices · ~<?php echo esc_html( number_format_i18n( $record['length_m'] ) ); ?> m<?php endif; ?>
							<?php if ( ! empty( $record['warnings'] ) ) echo '<br><span class="ftth-warn">' . esc_html( implode( ' ', $record['warnings'] ) ) . '</span>'; ?>
							<?php if ( empty( $record['locality'] ) ) echo '<br><span class="ftth-warn">Localidade não identificada; informe-a para selecionar o item.</span>'; ?>
							<?php if ( ! empty( $record['description'] ) ) echo '<details><summary>Descrição original</summary>' . esc_html( wp_strip_all_tags( $record['description'] ) ) . '</details>'; ?>
						<?php else : ?><span class="ftth-error"><?php echo esc_html( $record['error'] ?? 'Geometria não suportada' ); ?></span><?php endif; ?>
					</td>
				</tr>
				<?php endforeach; ?>
				</tbody></table></div></div>
			<?php submit_button( 'Confirmar importação dos itens marcados', 'primary', 'submit', true, array( 'onclick' => "return confirm('Confirma gravar os itens marcados nos CCTs do JetEngine?');" ) ); ?>
		</form>
		<p><a class="button" href="<?php echo esc_url( $this->admin_url() ); ?>">Cancelar e escolher outro arquivo</a></p>
		<script>
		(function(){
			const boxes=[...document.querySelectorAll('.ftth-include')];
			const safe=document.getElementById('ftth-select-safe');
			const all=document.getElementById('ftth-select-all');
			if(safe)safe.addEventListener('click',()=>boxes.forEach(box=>{const row=box.closest('tr');if(box.disabled)return;box.checked=!row.querySelector('.ftth-warn')&&!!row.querySelector('.ftth-locality')?.value.trim();}));
			if(all)all.addEventListener('click',()=>boxes.forEach(box=>{const row=box.closest('tr');if(box.disabled)return;box.checked=!!row.querySelector('.ftth-locality')?.value.trim();}));
		})();
		</script>
		<?php
	}

	private function render_notice() {
		$code = isset( $_GET['ftth_notice'] ) ? sanitize_key( wp_unslash( $_GET['ftth_notice'] ) ) : '';
		$messages = array(
			'upload_error' => array( 'error', 'Não foi possível receber o arquivo.' ),
			'size_error' => array( 'error', 'O arquivo está vazio ou excede o limite de 20 MB.' ),
			'format_error' => array( 'error', 'Formato não suportado. Envie KML ou KMZ.' ),
			'zip_unavailable' => array( 'error', 'A extensão ZIP do PHP não está disponível no servidor.' ),
			'kmz_invalid' => array( 'error', 'O KMZ está inválido ou não contém um KML legível.' ),
			'kml_invalid' => array( 'error', 'O XML KML está inválido ou excede o limite permitido.' ),
			'no_placemarks' => array( 'error', 'Nenhum elemento Placemark foi encontrado no arquivo.' ),
			'preview_expired' => array( 'error', 'A prévia expirou; envie o arquivo novamente.' ),
			'status_error' => array( 'error', 'Status selecionado inválido.' ),
			'cct_error' => array( 'error', 'Não foi possível criar o lote no CCT mapa_importacoes.' ),
			'import_partial' => array( 'warning', 'Importação concluída com alguns alertas. Confira o relatório no CCT mapa_importacoes.' ),
			'import_done' => array( 'success', 'Importação concluída. Confira os totais no CCT mapa_importacoes.' ),
		);
		if ( isset( $messages[ $code ] ) ) {
			$class = 'notice notice-' . $messages[ $code ][0 ] . ' is-dismissible';
			echo '<div class="' . esc_attr( $class ) . '"><p>' . esc_html( $messages[ $code ][1] ) . '</p></div>';
		}
	}
}

add_action( 'plugins_loaded', array( 'Inmov_JetEngine_FTTH_Importer', 'instance' ), 20 );
