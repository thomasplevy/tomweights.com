<?php
/**
 * Parses the dot env file and loads the values in the env if the values aren't already set.
 */

$dotenv = '.env';
$lines  = file( dirname( __FILE__ ) . '/' . $dotenv, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES );
foreach ( $lines as $line ) {

    if ( 0 === strpos( trim( $line ), '#' ) ) {
        continue;
    }

    list( $key, $val ) = explode( '=', $line, 2 );

    $key = trim( $key );
    $val = trim( $val );

    if ( false === getenv( $key ) ) {
        putenv( sprintf( '%1$s=%2$s', $key, $val ) );
    }

}