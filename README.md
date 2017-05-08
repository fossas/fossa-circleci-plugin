# Circle CI plugin for Checking on FOSSA builds.

## Setup

1. You must retrieve a FOSSA API token. This is found in FOSSA under [Account Settings](http://app.fossa.io/account/settings/integrations)
2. You must set this as an environment variable named `FOSSA_API_TOKEN` in your Circle CI build
3. Add a custom build step in your `circle.yml` file like so: 
	```
		test:
		  pre:
		    -node <fossa plugin location>/index.js
	```

4. (optional) Set a timeout for pinging the FOSSA API. By default, timeout is 30 minutes. This can be set via the Environment variable: `FOSSA_POLL_TIMEOUT`. You must specify in milliseconds, ex: `1000 * 60 * 30` (30 minutes)