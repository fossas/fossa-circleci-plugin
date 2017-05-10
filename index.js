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

function getResource (url) {
	return request.getAsync({
		url: url,
		method: 'GET',
		headers: request_headers
	})
	.then(function (response) {
		return JSON.parse(response.body)
	})
}

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
	queue_build_endpoint = url.resolve(api_base_url, '/api/revisions/build')
	build_endpoint = url.resolve(api_base_url, '/api/builds')
	scan_endpoint = url.resolve(api_base_url, '/api/revisions/' + encodeURIComponent(full_fossa_locator))

	// API Access token to access FOSSA API
	request_headers = {
		Authorization: 'token ' + process.env['FOSSA_API_TOKEN']
	}
}

function run () {
	return queueFOSSABuild()
	.then(function (build) {
		if (!build.id) {
			console.error('Build queue failed')
			process.exit(1)
		}
		if (build.status && build.status !== 'RUNNING') return build
		return pollFOSSABuildResults(build.id)
	})
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
function pollFOSSABuildResults (build_id) {
	console.log("Polling FOSSA build: " + build_id)
	function poll () {
		return getResource(build_endpoint + '/' + build_id)
		.then(function (build_data) {
			var completed_build = (build_data.status && build_data.status !== 'RUNNING') //Build is not null and either FAILED or SUCCEEDED
			// if no build has been found yet, or it is still queued/running wait then ping URL again
			if (!completed_build) {
				return Promise.delay(PING_WAIT_TIME).then(poll)
			}

			return build_data
		})
	}

	return poll().timeout(POLL_TIMEOUT) // total timeout time of 30 minutes
	.catch(function (err) {
		console.error('Error fetching FOSSA build: ' + err.toString())
		process.exit(1)
	}) 
	
}

function pollFOSSAScanResults () {
	console.log("Checking FOSSA for resolved revision.")
	function poll () {
		return getResource(scan_endpoint)
		.then(function (scan_data) {
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

function queueFOSSABuild () {
	console.log("Queuing a FOSSA build.")
	return request.postAsync({
		url: queue_build_endpoint,
		method: 'POST',
		headers: request_headers,
		json: {
			locator: full_fossa_locator
		}
	})
	.then(function (response) {
		return response.body
	})
}

// setup global vars
setup()
// run!
run()
