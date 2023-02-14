const { Console } = require('console');
const { inlineSource } = require( 'inline-source' ),
    glob           = require( 'fast-glob' ),
    fs             = require( 'fs' ),
    path           = require( 'path' ); 

function deleteEmptyDirs( dir ) {
    if ( ! fs.statSync( dir ).isDirectory() ) {
        return;
    }

    let files = fs.readdirSync( dir );
    if ( files.length > 0 ) {
        files.forEach( ( file ) => {
            deleteEmptyDirs( path.join( dir, file ) );
        } );
        files = fs.readdirSync( dir );
    }

    if ( 0 === files.length ) {
        console.log( `Removing empty directory: ${ dir  }.` );
        fs.rmdirSync( dir );
    }
}

const staticDir    = path.resolve( 'static' ),
    htmlFiles      = glob.sync( `${ staticDir }/**/*.html` ),
    assetsToRemove = glob.sync( [
        `${ staticDir }/**/*.js`,
        `${ staticDir }/**/*.css` 
    ] );

(async()=>{
    for ( let i = 0; i < htmlFiles.length; i++ ) {
    
        const file = htmlFiles[ i ];
        try {
            const html = await inlineSource( file, {
                compress: true,
                ignore: [ 'png', 'jpg' ],
                rootpath: staticDir,
                attribute: false,
            } );
            console.log( `Inlining static assets in: ${ file }.` );
            fs.writeFileSync( file, html );
        } catch ( e ) {
            console.error( e );
        }
    
    }
    
    assetsToRemove.forEach( ( file ) => {
        console.log( `Removing inlined static asset: ${ file }.` );
        fs.unlinkSync( file )
    } );  
    
    deleteEmptyDirs( staticDir );
})();