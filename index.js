#!/bin/node
var Promise = require('bluebird')
var request = Promise.promisifyAll(require('request'))
var url = require('url')
var _ = require('underscore')

var POLL_TIMEOUT = process.env['FOSSA_POLL_TIMEOUT'] || 1000 * 60 * 30 // 30 minute polling timeout
var PING_WAIT_TIME = 1000 * 10 // 15 second ping wait time

var api_base_url
var fossa_project_id
var full_fossa_locator
var build_endpoint
var scan_endpoint
var request_headers


function setup () {
	if (!process.env['FOSSA_API_TOKEN']) {
		console.error('Environment variable \'FOSSA_API_TOKEN\' not found')
		process.exit(1)
	}

	api_base_url = process.env['FOSSA_ENDPOINT_URL'] || 'http://app.fossa.io/'
	// Get project information from CircleCI Environment variables
	fossa_project_id = 'git+' + process.env['CIRCLE_REPOSITORY_URL']
	full_fossa_locator = fossa_project_id + '$' + process.env['CIRCLE_SHA1']

	// Build the FOSSA endpoint URL's
	build_endpoint = url.parse(url.resolve(api_base_url, '/api/builds'), true)
	build_endpoint.query = {
		projectId: fossa_project_id
	}
	build_endpoint = url.format(build_endpoint)
	scan_endpoint = url.resolve(api_base_url, '/api/revisions/' + encodeURIComponent(full_fossa_locator))

	// API Access token to access FOSSA API
	request_headers = {
		Authorization: 'token ' + process.env['FOSSA_API_TOKEN']
	}
}

function run () {
	return pollFOSSABuildResults()
	.then(function (build) {
		if (build.status === 'FAILED') throw new Error('FOSSA Build failed. Build error: ' + (build.error || '') )

		// build has succeeded! Now check if FOSSA has scanned it for issues yet...
		return pollFOSSAScanResults()
	})
	.then(function (revision) {
		if (revision.unresolved_issue_count > 0) throw new Error('FOSSA Issue scan has found issues. Please resolve these to pass build.')

		console.log('FOSSA scan has passed.')
		process.exit(0) 	// Success!
	})
	.catch(function (err) {
		console.error('Error getting FOSSA build data: ' + err.toString())
		process.exit(1)
	})
}

// This function will ping the FOSSA API for build data on the current SHA1 of the build. It will keep pinging this URL for 30 minutes
function pollFOSSABuildResults () {
	function poll () {
		return request.getAsync({
			url: build_endpoint,
			method: 'GET',
			headers: request_headers
		})
		.then(function (response) {
			var build_data = JSON.parse(response.body)
			var found_builds = _.filter(build_data, function (build) {
				return (build.locator === full_fossa_locator) && (build.finished)
			})
			var completed_build = false
			if (found_builds.length) {
				// sort by finished desc, and pick latest
				var found_build = _.first(
					found_builds.sort(function (a, b) {
						var a_date = new Date(a.finished)
						var b_date = new Date(b.finished)
						return b_date.getTime() - a_date.getTime()
					})
				)
				completed_build = (found_build.status && found_build.status !== 'RUNNING') //Build is not null and either FAILED or SUCCEEDED
			}
			// if no build has been found yet, or it is still queued/running wait then ping URL again
			if (!completed_build) {
				return Promise.delay(PING_WAIT_TIME).then(poll)
			}

			return found_build
		})
	}

	return poll().timeout(POLL_TIMEOUT) // total timeout time of 30 minutes
	.catch(function (err) {
		console.error('Error fetching FOSSA build: ' + err.toString())
		process.exit(1)
	}) 
	
}

function pollFOSSAScanResults () {
	function poll () {
		return request.getAsync({
			url: scan_endpoint,
			method: 'GET',
			headers: request_headers
		})
		.then(function (response) {
			var scan_data = JSON.parse(response.body)
			var scanned_revision = (scan_data.unresolved_issue_count !== null)
			
			// if issue count hasn't been set, then the revision still needs to be scanned
			if (!scanned_revision) {
				return Promise.delay(PING_WAIT_TIME).then(poll)
			}
			
			return scan_data
		})
	}

	return poll().timeout(POLL_TIMEOUT)
	.catch(function (err) {
		console.error('Error fetching FOSSA scan: ' + err.toString())
		process.exit(1)
	})
}

// setup global vars
setup()
// run!
run()
