var videoContainerAnchor = "#video-container"
var superBestFriendCastBaseURL = "http://traffic.libsyn.com/superbestfriendcast/";

var podcastLastSaved = null;
var podcastSaveLocked = false;

//Listen for post messages from our iframe injected event listener to get current video position
window.addEventListener('message', function(msg, sender, sendResponse) {
	if(msg.origin == "http://player.screenwavemedia.com"){
		var dataSaveValue = {};
		
		// Use video HREF as key. Need to ensure that video-container anchor is removed
		dataSaveValue[window.location.href.replace(videoContainerAnchor, "")] = msg.data;
		
		// Save to sync data to propagate through user's profile.
		chrome.storage.sync.set(dataSaveValue);		
	}
});

//Note: maybe run this at end of file to not need to wait as long?
$(window).ready(function(){
	//Setup actions for pages with a video player.
	CheckAndSetupPlayerActions();
	
	//Setup link/thumbnail position overlay
	CheckAndDisplayVideoThumbnails();
	
	//http://superbestfriendsplay.com/series/friendcast/
	CheckAndDisplayLatestPodcast();
});

// Find podcast URL, title and date
function CheckAndDisplayLatestPodcast()
{
	if(window.location.href.indexOf('/series/friendcast/') > 0)
	{	
		//you're on the series page, find the latest item in the list.
		var podcastLink = $('.archivetitle a')[1];
		var podcastDate = $('.archivedate')[0].innerHTML;
		
		var podcastUrl = podcastLink.href;
		var podcastTitle = podcastLink.text;
		
		PopulatePodcastPlayer(podcastUrl, podcastTitle, podcastDate);
	}
	else
	{
		// Request the series page to get latest episode
		$.ajax({
			'url':'/series/friendcast/',
			'dataType':'html',
			'success': function(data, status)
			{
				// parse returned data to get the relevant elements
				var archiveItemIndex = data.indexOf('<li class="archiveitem">');
				var archiveItemEnd = data.indexOf('</li>', archiveItemIndex) + 6;
				
				// turn archive items and children into dom objects to make searching easier.
				var archiveDivContent = $(data.substring(archiveItemIndex, archiveItemEnd));
				
				var podcastLink = archiveDivContent.find('a')[3];
				var podcastDate = archiveDivContent.find('.archivedate')[0].innerHTML;
				
				var podcastUrl = podcastLink.href;
				var podcastTitle = podcastLink.text;
											
				PopulatePodcastPlayer(podcastUrl, podcastTitle, podcastDate);				
			}
		});
	}	
}

// Populate audio element and attach to the userbar
function PopulatePodcastPlayer(podcastUrl, podcastTitle, podcastDate)
{	
	// find podcast code from URL
    var result = (/sbfc-[0-9]*/i).exec(podcastUrl);
	
	if(result !== null && result.length === 1)
	{	 
		var podcastFilename = result[0].replace('-','');
		
		// Save another request, and use standard naming convention for mp3 file
		var playerBestGuessLocation = superBestFriendCastBaseURL + podcastFilename + ".mp3";
		
		// Apend audio element to the end of the userbar		
		$("#socialelements a:last-child").after($('<div id="sbfc-audio-container"><audio id="sbfc-audio" src="' + playerBestGuessLocation + '" controls></audio><span id="sbfc-audio-notwatched">!</span><div id="sbfc-audio-data"><div id="sbfc-audio-data-triangle"></div><h2>' + podcastTitle + '</h2><h3>' + podcastDate + '</h3></div></div>'));		
		
		var player = $('#sbfc-audio');			
		
		chrome.storage.sync.get("sbf:podcast:" + playerBestGuessLocation, function(positionObject){					
			var keys = Object.keys(positionObject);
			if(keys.length > 0){
				var key = keys[0];					
				var position = positionObject[key];
				player.bind('canplay', function(){
					this.currentTime = position.position;
				});
			}
			else
			{
				//new, add ! beside player to indicate unwatched
				$('#sbfc-audio-notwatched').addClass('unwatched');				
			}
		});
		
		// Setup listener to update current position to sync storage.
		player.bind('timeupdate', function(event){			
			var currentDate = new Date();
			
			if(podcastSaveLocked === false && (podcastLastSaved === null || 
				Math.abs((currentDate.getTime() - podcastLastSaved.getTime()) / 1000) > 5))
			{
				podcastLastSaved = currentDate;
				podcastSaveLocked = true;
				
				var dataSaveValue = {};
				dataSaveValue["sbf:podcast:" + this.src] = {'position': this.currentTime, 'duration': this.duration};

				chrome.storage.sync.set(dataSaveValue);				
				podcastSaveLocked = false;
			}
		});
	}	
}

function CheckAndDisplayVideoThumbnails()
{	
	// Get all watched videos, and process.	
	chrome.storage.sync.get(null, function(watchedVideoArray){
		for(var videoHref in watchedVideoArray)
		{
			//don't include non-href position data
			if(videoHref.lastIndexOf('sbf:', 0) === -1)
			{
				// links may have #video-container anchor, so do a wildcard to return all results
				var linksInPage = $('a[href*="' + videoHref +'"]');				
				if(linksInPage.length > 0)
				{
					var videoData = watchedVideoArray[videoHref]	
					var positionData = JSON.parse(videoData);
					
					if(positionData.position > 0)
					{
						// get percentage to display current approximate position
						var percentage = Math.round((positionData.position / positionData.duration) * 100);					
						
						for(var i = 0; i < linksInPage.length; i++)
						{
							var linkElement = $(linksInPage[i]);

							// There are a couple links, the ones we want will have at least one child
							if(linkElement.children().length > 0)
							{								
								linkElement.append('<div class="sbfc-videoposition-container"><div style="height: 10px;width: '+ percentage + '%;background-color: #FFC515;"></div></div>');
							}
						}
					}
				}
			}			
		}
	});
}

// setup video watcher and seeker. Only works with JW Player
function CheckAndSetupPlayerActions()
{
	var playerFrame = $('.video-container iframe');
	
	if(playerFrame.length === 1 && playerFrame[0].src.indexOf('youtube') === -1)
	{	
		playerFrame = playerFrame[0];
		var playerWindow = playerFrame.contentWindow;		
		
		$(playerFrame).ready(function(){		
			SeekPlayer(playerWindow);
			SetupPositionWatcher(playerWindow);
		});
	}
}

/* 
	Sends JS script to video player iframe to attach an event to the 
	player, to call back to us when video position changes.
	Cannot directly get JS vars from iframe (domain security), but
	adopting a script element and running it will work.
*/
function SetupPositionWatcher(playerWindow)
{
	//Setup passthrough - will post message cross-browser on position change
	var elem = playerWindow.document.createElement("script");
	elem.type = "text/javascript";
	
	//Post once per second max, and lock while processing is happening to stop doubling up.
	var playerHtml = "var lastStored = null;var extensaionCallbackLocked = false;jwplayer(playerName).onTime(function(playerPosition){var currentDate = new Date();if(extensaionCallbackLocked === false && (lastStored === null || Math.abs((currentDate.getTime() - lastStored.getTime()) / 1000) > 1)){lastStored = currentDate;extensaionCallbackLocked = true;parent.postMessage(JSON.stringify(playerPosition),'http://superbestfriendsplay.com/');extensaionCallbackLocked = false;}});";

	elem.innerHTML = playerHtml;					
	playerWindow.document.head.appendChild(elem);
}

// Called on load, will seek the player to the stored position, and pause video.
function SeekPlayer(playerWindow)
{
	chrome.storage.sync.get(window.location.href.replace("#video-container",""), function(positionObject){
		var keys = Object.keys(positionObject);
		
		if(keys.length > 0)
		{
			var key = keys[0];
			var position = JSON.parse(positionObject[key]);
			
			var elem = playerWindow.document.createElement("script");
			elem.type = "text/javascript";
			var playerHtml = "jwplayer(playerName).seek(" + position.position + "); jwplayer(playerName).pause();";
			
			elem.innerHTML = playerHtml;					
			playerWindow.document.head.appendChild(elem);
		}
	});
}
