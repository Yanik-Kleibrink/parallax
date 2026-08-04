// The actual logging implementation is only used in the binary so
// that it can be overriden when the library is imported.
use parallax_server::base::Base;

use std::path::PathBuf;

// TODO: Then forward the logs to any wheel user via a websocket
// connection.

#[actix_web::main]
async fn main() {
    use tracing_subscriber;

    tracing_subscriber::fmt::init();

    let path =
        std::env::args().nth(1).expect("Usage: parallax <path>");

    let path = PathBuf::from(path);

    let _ = Base::build(&path).unwrap().go().await;
}
