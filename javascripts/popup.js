
//var syncPad = function(extData, $, localStorage) {

var extData = extData || {};

$.extend(extData,{
    background: undefined,

    popup : this,

    times : {
        popup: (new Date())-start
    },

    sentTimeBeacon: false,

    preLoadFactor : 1/2, // amount of vertical viewport size to add for preloading notes in index

    currentView: "index",

    slideEasing: "swing", // swing or linear

    slideDuration: 200,

    isTab : false,

    editorSaveTime: 6000,

    dimensions : {
        def:  {
            index_left: 0,
            index_right: 0,
            note_left: 401,
            body_width: 400,
            body_height: 550
        },
//        selected: {
//            index_left: 2,
//            index_right: 2,
//            note_left: 400,
//            body_width: 800,
//            body_height: 550
//        },
        focus: {
            index_left: -400,
            index_right: -2,
            note_left: 0,
            body_width: 800,
            body_height: 550
        }
    },

    fontUrls : {
        "Walter Turncoat"   : '<link href="http://fonts.googleapis.com/css?family=Walter+Turncoat:regular" rel="stylesheet" type="text/css" >',
        "Inconsolata"       : '<link href="http://fonts.googleapis.com/css?family=Inconsolata:regular" rel="stylesheet" type="text/css" >',
        "Lekton"            : '<link href="http://fonts.googleapis.com/css?family=Lekton" rel="stylesheet" type="text/css">',
        "Yanone Kaffeesatz" : '<link href="http://fonts.googleapis.com/css?family=Yanone+Kaffeesatz:300" rel="stylesheet" type="text/css" >',
        "Vollkorn"          : '<link href="http://fonts.googleapis.com/css?family=Vollkorn:regular" rel="stylesheet" type="text/css" >'
    },

    builtinTags : ["webnotes","checklist"]

});

//  ---------------------------------------

var snEditor, snIndex;

//  ---------------------------------------
function log(s) {

    if (extData.debugFlags.popup)
        logGeneral(s,"popup.js",console);
    if (extData.debugFlags.popup2BG)
        logGeneral(s,"popup.js",extData.background.console);
}

//  ---------------------------------------
// event listener for popup close
// defer save to background
function unloadListener() {
    try {
        if (snEditor && snEditor.isNoteDirty()) {
            var note = {};
            log("(unload): requesting background save");

            if (snEditor.dirty.content)
                note.content = snEditor.codeMirror.getCode();
            if (snEditor.dirty.pinned) {
                snEditor.needCMRefresh("pinned");
                note.systemtags = snEditor.note.systemtags;
                if (!snEditor.isPintoggle()) {
                    note.systemtags.splice(note.systemtags.indexOf("pinned"),1);
                } else {
                    note.systemtags.push("pinned");
                }
            }
            if (snEditor.dirty.markdown) {
                note.systemtags = snEditor.note.systemtags;
                if (!snEditor.isMarkdownToggle()) {
                    note.systemtags.splice(note.systemtags.indexOf("markdown"),1);
                } else {
                    note.systemtags.push("markdown");
                }
            }
            if (snEditor.dirty.tags)
                note.tags = snEditor.getTags();
    //        if ($('div#note input#encrypted').attr("dirty")=="true")
    //            note.encrypted = $('div#note input#encrypted')?1:0;

            note.key = snEditor.note.key;

            log("(unload): note:");
            log(note);

            extData.background.SimplenoteBG.saveNote = note;
        } else
            log("(unload): no background save");

        if (snEditor)
            snEditor.saveCaretScroll();

        if (extData.isTab)
            extData.background.SimplenoteBG.setOpenPopup(true);

        extData.background.setTimeout("SimplenoteBG.popupClosed()", 10);
    } catch(e) {
        exceptionCaught(e);
    }
}

//  ---------------------------------------
//  event listener for "uiEvents" (anything background->popup)
//
// {name:"sync", status: "started|done|error", changes : {hadchanges: false|true, added:[keys],changed:[keys],deleted:[keys]}}
// {name:"noteadded", note:{note}}
// {name:"notedeleted", key: key}
// {name:"noteupdated", newnote:{note}, oldnote: {note}, changes:{hadChanges: false|true, added:[fields],changed:[fields], deleted:[fields]}}
// {name:"offlinechanged", status:true|false}
// {name:"synclistchanged", added|removed:key}
function uiEventListener(eventData, sender, sendResponse) {
    try {
        var eventName = eventData.name;
    //    if (syncInProgress && (eventName == "noteadded" || eventName == "noteupdated" || eventName == "notedeleted"))
    //            return;

        if (eventName == "sync") {

            log("EventListener:sync:" + eventData.status + ", hadChanges=" + eventData.changes.hadchanges );

            if (eventData.status == "started") {
                $("#sync").html(chrome.i18n.getMessage("sync_in_progress"));
            } else if (eventData.status == "done") {
                if (eventData.changes.hadchanges) {
                    snIndex.requestTags();
                    snIndex.requestNotes();
                    $("#sync").html(chrome.i18n.getMessage("sync_done_had_changes"));
                } else {
                    $("#sync").html(chrome.i18n.getMessage("sync_done"));
                }
            } else if (eventData.status == "error") {
                $("#sync").html(chrome.i18n.getMessage("sync_error")+ ": " + eventData.errorstr);
            }

        } else if (eventName == "noteadded") {
            log("EventListener:" + eventName);
            snIndex.requestTags();
            snIndex.requestNotes();
    //        if (!eventData.note.key.match(/created/))
    //             SNEditor.setNote(eventData.note);
        } else if (eventName == "noteupdated") {
            var newNote = new Note(eventData.newnote);
            var oldNote = new Note(eventData.oldnote);

            log("EventListener:noteupdated, source=" + eventData.source + ", changed=[" + eventData.changes.changed.join(",") + "], syncNote=" + newNote.isSyncNote());

            var delta = newNote.deltaTo(oldNote);

            console.log(JSON.stringify(delta))

            var pinnedNowOn = !oldNote.isPinned() && newNote.isPinned();
            var pinnedNowOff = oldNote.isPinned() && !newNote.isPinned();
            var pinnedChanged = pinnedNowOn || pinnedNowOff;

            var modifyChanged = eventData.changes.changed.indexOf("modifydate")>=0;
            var deleted = !oldNote.isDeleted() && newNote.isDeleted();
            var undeleted = oldNote.isDeleted() && !newNote.isDeleted();
            var markdownchanged = oldNote.isMarkdown() != newNote.isMarkdown();

            var needTagsRefresh = false;
            var needIndexRefresh = false;
            var needPinnedRefresh = false;
            var needLastOpenRefresh = false;

            if (deleted) {
                log("EventListener:noteupdated: deleted");

                if (newNote.$isIndexNote()) {
                    newNote.$remove();
                }
                if (newNote.isLastOpen()) {
                    snLastOpen.noteDeleted(newNote.key)
                    needLastOpenRefresh = true;
                }
                if (pinnedChanged)
                    needPinnedRefresh = true;

                needTagsRefresh = true;

            } else if (undeleted) {
                log("EventListener:noteupdated: undeleted");

                if (newNote.$isIndexNote())
                    newNote.$remove();

                if (pinnedChanged)
                    needPinnedRefresh = true;

                needTagsRefresh = true;

            } else if (!newNote.tagsSame(oldNote)) {
                log("EventListener:noteupdated:tags");
                needTagsRefresh = true;
                needIndexRefresh = true;
            } else if (modifyChanged || pinnedChanged) {
                if (modifyChanged)
                    log("EventListener:noteupdated:modifychanged");
                else if (pinnedNowOn)
                    log("EventListener:noteupdated:pinnednowon");
                else if (pinnedNowOff)
                    log("EventListener:noteupdated:pinnednowoff");

                if ((newNote.$isIndexNote() || pinnedNowOff) && localStorage.option_sortby != "createdate") {
                    needIndexRefresh = true;
                } else {
                    indexAddNote("replace", eventData.newnote);
                    if (eventData.newnote.content)
                        indexFillNote(eventData.newnote);
                }
            }

            newNote.$update();

            if (extData.isTab && newNote.$isEditorNote()) {
                if (markdownchanged) {
                    snEditor.updateMarkdown(newNote);
                    needTagsRefresh = true;
                } else if (eventData.changes.changed.indexOf("version") >= 0 && eventData.newnote.systemtags.indexOf("markdown")>=0) {
                    snEditor.updateMarkdown(newNote);
                }
            }
            if (eventData.source != "local" &&  newNote.$isEditorNote()) {
                    var contentChanged = eventData.changes.added.indexOf("content")>=0;
                    if (contentChanged && newNote.has)
                        snEditor.setNote(eventData.newnote);
            }
            if (needTagsRefresh)
                snIndex.requestTags();
            if (needIndexRefresh)
                snIndex.requestNotes();
            if (needPinnedRefresh)
                snEditor.needCMRefresh("pinned");
            if (needLastOpenRefresh)
                snEditor.needCMRefresh("lastopen");

        } else if (eventName == "offlinechanged") {
            log("EventListener:offline:" + eventData.status);
            if (eventData.status)
                $("#offline").html("offline");
            else
                $("#offline").html("");
        } else if (eventName == "synclistchanged") {
            log("igonring synclistchanged")
        } else if (eventName == "notedeleted") {
            log("EventListener:notedeleted:" + eventData.key);
            $('#' + eventData.key).remove();
            snIndex.requestTags();

            snLastOpen.noteDeleted(eventData.key);

            snEditor.hideIfNotInIndex(eventData.key);
        } else {
            log("EventListener:");
            log(eventData);
        }
    } catch (e) {
        exceptionCaught(e);
    }
}

// shortcuts
var shortcutListener = function (event) {

    if ($("#q").is(":focus")) {
        switch(event.keyCode) {
            case 27: // esc
                log("esc")
                $("#q_clear").mousedown();
                event.preventDefault();
                return;
            break
        }
    }

    if (event.altKey && !event.ctrlKey && !event.shiftKey)
        switch(event.keyCode) {
            case 88: //alt-x
                window.close();
            break
        }

    if (extData.isTab) {

        if (!event.altKey && event.ctrlKey && !event.shiftKey)
            switch(event.keyCode) {
                case 83: //ctrl-s
                    snEditor.saveNote();
                    event.preventDefault();
                break
            }
    }

    if (extData.currentView=="index" || extData.isTab) {
    // - index:
        var notesheight = $("#notes").get(0).scrollHeight;

        if (event.altKey && !event.ctrlKey && !event.shiftKey)
            switch(event.keyCode) {
                case 38: //alt-up
                    $("#notes").scrollTop($("#notes").scrollTop()-notesheight/20)
                break;
                case 40: //alt-down
                    $("#notes").scrollTop($("#notes").scrollTop()+notesheight/20)
                break;
                case 39: //alt-right
                break;
                case 65: //alt-a
                    event.preventDefault();
                    $("#add").click();
                    break;
                case 78: //alt-n
                    event.preventDefault();
                    $("#notetags").focus();
                    break;
                case 81: //alt-q
                    event.preventDefault();
                    $("#q").focus();
                    break;

            }
    }

    if (extData.currentView=="editor" || extData.isTab) {
        // - editor:
        if (event.altKey && !event.shiftKey && !event.ctrlKey)
            switch(event.keyCode) {
                case 83: //alt-s
                    snEditor.searchForSelection();break;
                case 86: //alt-v
                    if (!extData.isTab) snEditor.insertUrl();break;
                case 66: //alt-b
                    $('#backtoindex').click();break;
                case 82: //alt-r
                    if (!extData.isTab) $('#revert').click();break;
                case 79: //alt-o
                    if (!extData.isTab) $('#popout').click();break;
                case 80: //alt-p
                    $('#pintoggle').click();
                    break;
                case 87: //alt-w
                    $("#wraptoggle").click();
                    break;
                case 84: //alt-t
                    event.preventDefault();
                    $("#tagsauto").focus();
                    break;
                case 69: //alt-e
                    event.preventDefault();
                    snEditor.focus();
                    break;
            }
        if (event.altKey && !event.shiftKey && event.ctrlKey)
            switch(event.keyCode) {
                case 68: //crtl-alt-d
                    $('#trash').click();break;
            }
    }
}

//  ---------------------------------------
function readyListener() {

    tick("ready");

    extData.times.ready = (new Date())-start;

    try {

        extData.background = chrome.extension.getBackgroundPage();
        chrome.browserAction.setBadgeText({
            text:""
        }); // reset badge

        if (!extData.background || !extData.background.loaded) {
            console.log("deferring listener a bit");
            _gaq.push(['_trackEvent', 'popup', 'ready', 'deferred_a_bit']);
            setTimeout("readyListener()",1000);
            return;
        }
        var m = location.href.match(/\?.*tab\=(true|false).*/);
        extData.isTab = m != undefined && m[1] == "true";

        if (extData.isTab) {
            log("---------------- tab opened ---------------------");
            chrome.tabs.getCurrent(function (tab) {
                extData.background.SimplenoteBG.setOpenTab(tab);
            })
        } else {
            log("---------------- popup opened ---------------------");
        }

        var signUpLink =  "<a href='https://simple-note.appspot.com/create/'>" + chrome.i18n.getMessage("signup") + "</a>";
        var optionsLink = "<a href='options.html'>" + chrome.i18n.getMessage("options_page") + "</a>";
        var loginLink = "<a href='https://simple-note.appspot.com/signin/'>" + "login page" + "</a>";

        if ( !SimplenoteSM.haveLogin() ) {

            _gaq.push(['_trackEvent', 'popup', 'ready', 'no_email_or_password']);

            log("(ready): no email or password");

            //Here display login instead.
  //          $("#y").load("x.html");
//aaaaaaaaa
//  $('#notes').html("asd");
//displayStatusMessage($("#signin").html());
          // displayStatusMessage(chrome.i18n.getMessage("welcometext", [signUpLink, optionsLink]));
          setUpForMessage();
         $('#notes').html($("#signin").html());


//$("#signin").show();

        } else if ( !SimplenoteSM.credentialsValid() ) {

            _gaq.push(['_trackEvent', 'popup', 'ready', 'credentails_not_valid']);
            log("(ready): credentials not valid");

            if (SimplenoteSM.webapplogin()) {
                displayStatusMessage("You seem to be no longer logged in with Simplenote. Please login on the Simplenote " + loginLink + ".");
            } else {
                displayStatusMessage("Login for email '" + SimplenoteSM.email() + "' failed, please check your Simplenote email address and password on the " + optionsLink + "!");
            }

        } else {
            extData.times.startsetup = (new Date())-start;

            //$("body").show();

            if (localStorage.option_gpuaccel == "true")
                $("#notes").css("-webkit-transform","translateZ(0)");

            if (!extData.isTab) {
                $("#print").hide();

                if (!snLastOpen.isOpen()) {
                    $("body").css("width", extData.dimensions.def.body_width + "px");
                    $("body").css("height", extData.dimensions.def.body_height + "px");
                } else {
                    $("body").css("width", extData.dimensions.focus.body_width + "px");
                    $("body").css("height", extData.dimensions.focus.body_height + "px");

                    $("#revert").hide();
                    $("#trash").show();
                    $('#popout').show();

                    $("#note").css("left", extData.dimensions.focus.note_left + "px");

                    $("#note").show();

                }
            } else {
                $("#note").show();
                $("#index").show();
                $("body").addClass("tab");
            }

            popupi18n();

            if (snLastOpen.isOpen()) {
                extData.currentView = "editor";
                snEditor = new SNEditor(function() {
                    log("(ready): sending request for open to note");
                    snEditor.setNote(SimplenoteLS.getNote(snLastOpen.key()),{
                                    duration:0,
                                    focus: true
                                });
//                    NoteFactory(snLastOpen.key(), function(note) {
//                            if (note)
//                                snEditor.setNote(note,{
//                                    duration:0,
//                                    focus: true
//                                });
//                        });
                });
            } else {
                snEditor = new SNEditor();
            }

            snIndex = new SNIndex();
            snIndex.snNotelist.request(true);

            $("body").show();
//                if (localStorage.option_color_index)
//                    $("body").css("background-color",localStorage.option_color_index);


            setTimeout(function() {
                log("(ready, delayed): requesting full sync.");
                chrome.extension.onRequest.addListener(uiEventListener);

                chrome.extension.sendRequest({
                    action: "sync",
                    fullsync:true
                }, function() {
                    log("(ready, delayed + async): sync request complete");
                });
            },1000);

            extData.times.endsetup = (new Date())-start;

            _gaq.push(['_trackEvent', 'popup', 'ready', 'startsetup', extData.times.startsetup]);
            _gaq.push(['_trackEvent', 'popup', 'ready', 'endsetup', extData.times.endsetup]);
            //tooltip("[title]");

        }

        scheduleGA();


    } catch (e) {
        exceptionCaught(e);
    }

    function popupi18n() {
        $("#q").attr("placeholder",chrome.i18n.getMessage("search_placeholder"));
        $("#q").attr("title",chrome.i18n.getMessage("search_tooltip","alt-q"));
        $("#notetags").attr("title",chrome.i18n.getMessage("tagselect_tooltip","alt-n"));
        $("#add").attr("title",chrome.i18n.getMessage("add_tooltip","alt-a"));
        $("#add_webnote").attr("title",chrome.i18n.getMessage("add_webnote_tooltip"));
        $("#snlink").attr("title",chrome.i18n.getMessage("snlink_tooltip"));
        $("#sync").attr("title",chrome.i18n.getMessage("sync_tooltip"));
        $("#pintoggle").attr("title",chrome.i18n.getMessage("pin_tooltip","alt-p"));
        $("#popout").attr("title",chrome.i18n.getMessage("popout_tooltip","alt-o"));
        $("#trash").attr("title",chrome.i18n.getMessage("trash_tooltip"," (ctrl-alt-d)"));
        $("#wraptoggle").attr("title",chrome.i18n.getMessage("wordwrap_tooltip","alt-w"));
        $("#revert").attr("title",chrome.i18n.getMessage("revert_tooltip","alt-r"));
        $("#print").attr("title",chrome.i18n.getMessage("print_tooltip"));

        if (extData.isTab)
            $('#backtoindex').attr("title",chrome.i18n.getMessage("close_tab_tooltip",["alt-b","alt-x"]));
        else
            $("#backtoindex").attr("title",chrome.i18n.getMessage("backtoindex_tooltip",["alt-b","alt-x"]));

    }

    function setUpForMessage(){
      $('#toolbar').hide();
      $('#statusbar').hide();
      $('#note').show();
      $("body").show();
      $("#index").show();
    }
    function displayStatusMessage(message) {

      setUpForMessage();
        $('#notes').html(message);
        $('body').addClass("message");

        $('a').attr('target', '_blank').click(function() {window.close();});
    }
}

function SNIndex() {
    this.$ui = $("#index");

    this.snToolbar = new SNToolbar(this);
    this.snNotelist = new SNNotelist(this);

    // bind SYNC div
    $("#sync").click( function() {
        _gaq.push(['_trackEvent', 'popup', 'syncclicked']);
        chrome.extension.sendRequest({
            action: "sync",
            fullsync:true
        });
    })
    $("#snlink").click( function(event) {
        _gaq.push(['_trackEvent', 'popup', 'snlinkclicked']);
        openURLinTab("https://simple-note.appspot.com/",event.ctrlKey || event.altKey);
    })
}

SNIndex.prototype.requestNotes = function() {
    this.snNotelist.request();
}

SNIndex.prototype.requestTags = function() {
    this.snToolbar.snTagselect.request();
}

function SNToolbar(snIndex) {
    this.$ui = $("#toolbar");

    this.snSearchfield = new SNSearchfield(snIndex);
    this.snTagselect = new SNTagselect(snIndex);
    this.snIndex = snIndex;

    // bind ADD button
    $('#add').click(function() {
        _gaq.push(['_trackEvent', 'popup', 'addclicked']);
        snEditor.setNote();
    });

    // bind ADD WEBNOTE button
    $('#add_webnote').click(function() {

        _gaq.push(['_trackEvent', 'popup', 'addwebnoteclicked']);

        chrome.extension.sendRequest({
            action: "webnotes",
            request: {
                action: "new"
            }
        }, function(ok) {
            if (ok)
                extData.popup.close();
        });
    });

}

SNToolbar.prototype.setHeight = function(to) {

    this.$ui.animate({height: to + "px"});
    this.snIndex.snNotelist.$ui.animate({top: to + 6 + "px"});

}

function SNSearchfield(snIndex) {

    this.$ui = $("#q");
    this.initialwidth = this.$ui.css("width");
    this.snIndex = snIndex;

    var that = this;


    // bind SEARCH field
    this.$ui.bind("keyup", function(event) {
        if (event.which == 13) {
            snEditor.setNote({
                content:$(this).val() + "\n",
                tags:[],
                systemtags:[],
                key:""
            },{
                isnewnote: true,
                focus: true
            });
        } else if (event.which == 27) {
            //event.stopPropagation();
        } else
            that.snIndex.snNotelist.request();

    }).focus(function() {
        log("#q focus")
        //$("#toolbar").children().not(this).not("#q_clear").hide();
        $(this).addClass("max").animate({width:"300px"},{duration: 200, complete: function() {
                $("#q_clear").show();
            }});
    }).blur(function(event) {
        log("blur")
        $(this).removeClass("max");
        $(this).animate({width:that.initialwidth},{duration: 200, complete: function() {
                $("#toolbar").children().not(this).not("#q_clear").show();
                if (that.$ui.val().trim() == "")
                    $("#q_clear").hide();

            }});
    });

    $("#q_clear").bind("mousedown",function(event) {
        log("q_clear mousedown")
        that.$ui.val("");
        $("#q_clear").hide();
        that.$ui.blur()
        event.stopPropagation();
        $("body").focus();
        that.snIndex.snNotelist.request();
    });
}

function tooltip(sel,opts) {
    opts = $.extend({
        effect: 'slide',
        predelay: 1000,
        events: {
          def:     "mouseover,mouseout",
          input:   "mouseover,mouseout",
          widget:  "mouseover,mouseout",
          tooltip: "mouseover,mouseout"
        },
        opacity: 0.95
    }, opts);

    $(sel).tooltip(opts).dynamic({bottom: {direction: 'down', bounce: true}});
}

function SNTagselect(snIndex) {
    this.$ui = $("#notetags");
    this.snIndex = snIndex;
    // tags stuff
    this.indextag = "#all#";
    this.taginfos = [];

    //this.request();
    this.request(true);

}

SNTagselect.prototype.setTag = function(to) {
    this.indextag = to;
    this.$ui.val(to);
}


SNTagselect.prototype.request = function(useLS) {
    tock("requestTags");
    var that = this;

    if (!useLS) {
        chrome.extension.sendRequest({action:"tags"}, function(taginfos) {
            try {
                that.fillWith(taginfos);
            } catch (e) {
                exceptionCaught(e);
            }
        });
    } else
        this.fillWith(SimplenoteLS.getTags());

}

SNTagselect.prototype.fillWith = function(taginfos) {
    tock("buildTagList");
    var that = this;

    this.taginfos = taginfos;
    // fill dropdown
    var stillhavetag = false;
    var style, html = "", taginfo;

    for (var i=0; i<taginfos.length; i++) {
        taginfo = taginfos[i];
        style = taginfo.count > 0?"":'style="color:#aaa; text-shadow:1px 1px 1px rgba(0,0,0,0.1)"';
        if (taginfo.tag == "#all#")
            html += '<option value="" ' + style +  '>' + chrome.i18n.getMessage("tags_all") + ' [' + taginfo.count + ']</option>';
        else if (taginfo.tag == "#notag#")
            html += '<option value="#notag#" ' + style +  '>' + chrome.i18n.getMessage("tags_untagged") + ' [' + taginfo.count + ']</option>';
        else if (taginfo.tag == "#trash#")
            html += '<option value="#trash#" ' + style +  '>' + chrome.i18n.getMessage("tags_deleted") + ' [' + taginfo.count + ']</option>';
        else if (taginfo.tag == "#published#")
            html += '<option value="#published#" ' + style +  '>' + chrome.i18n.getMessage("tags_published") + ' [' + taginfo.count + ']</option>';
        else if (taginfo.tag == "#shared#")
            html += '<option value="#shared#" ' + style +  '>' + chrome.i18n.getMessage("tags_shared") + ' [' + taginfo.count + ']</option>';
        else if (taginfo.tag == "#webnote#")
            html += '<option value="#webnote#" ' + style +  '>' + chrome.i18n.getMessage("tags_webnote") + ' [' + taginfo.count + ']</option>';
        else if (taginfo.tag == "#markdown#")
            html += '<option value="#markdown#" ' + style +  '>' + chrome.i18n.getMessage("tags_markdown") + ' [' + taginfo.count + ']</option>';
        else if (extData.builtinTags.indexOf(taginfo.tag.toLowerCase()) < 0) {
            html += '<option value="' + taginfo.tag + '" ' + style +  '>' + taginfo.tag + " [" + taginfo.count + "] </option>";
        }
        if (this.indextag == taginfo.tag)
            stillhavetag = true;
    }
    if (!stillhavetag) {
        this.indextag = "#all#";
    }

   // add handler
    this.$ui.unbind();
    this.$ui.html(html);
    this.$ui.val(this.indextag);
    this.$ui.change(function(event) {
        log("#notetags:changed: calling requestNotes");
        that.indextag = $(this).val();
        that.snIndex.snNotelist.request(true);
    });

    if (!stillhavetag) {
        this.requestNotes();
    }

    tock("buildTagList ende");
}

function SNNotelist(snIndex) {
    this.$ui = $("#notes");
    var that = this;
    // properties
    this.scrolltoselected = true;

    // get globals for speed
    this.extData = extData;
    this.snIndex = snIndex;
    this.snEditor = snEditor;
    this.storage = localStorage;
    this.click_to_undelete = chrome.i18n.getMessage("click_to_undelete");
    this.click_to_pinunpin = chrome.i18n.getMessage("click_to_pinunpin");
    this.syncnote_tooltip = chrome.i18n.getMessage("syncnote_tooltip");
    this.created = chrome.i18n.getMessage("created");
    this.modified = chrome.i18n.getMessage("modified");
    this.published_tooltip = chrome.i18n.getMessage("published_tooltip");
    this.sharer_tooltip = chrome.i18n.getMessage("sharer_tooltip");
    this.sharee_tooltip = chrome.i18n.getMessage("sharee_tooltip");

    $.timeago.settings.strings= {
        prefixAgo: null,
        prefixFromNow: null,
        suffixAgo: "",
        suffixFromNow: "from now",
        seconds:    chrome.i18n.getMessage("seconds"),
        minute:     chrome.i18n.getMessage("minute"),
        minutes:    chrome.i18n.getMessage("minutes"),
        hour:       chrome.i18n.getMessage("hour"),
        hours:      chrome.i18n.getMessage("hours"),
        day:        chrome.i18n.getMessage("day"),
        days:       chrome.i18n.getMessage("days"),
        month:      chrome.i18n.getMessage("month"),
        months:     chrome.i18n.getMessage("months"),
        year:       chrome.i18n.getMessage("year"),
        years:      chrome.i18n.getMessage("years"),
        numbers: []
    }

    this.$ui.delegate(".statusicon-clickable","click",statusIconClickHandler)
            .delegate(".noterow","click",noteRowClickHandler);

    //this.request();

    function statusIconClickHandler(event) {

        if (event.which != 1) {
            return;
        }

        var $src = $(event.srcElement);
        var note = that.getNote($src.parent(".noterow").attr("id"));

        if (!note)
            return;

        if ($src.hasClass("pin-toggle") && $src.hasClass("active")) {
            note.systemtags.splice(note.systemtags.indexOf("pinned"),1);
            chrome.extension.sendRequest({action:"update", key:note.key, systemtags:note.systemtags});
        } else if ($src.hasClass("pin-toggle")) {
            note.systemtags.push("pinned");
            chrome.extension.sendRequest({action:"update", key:note.key, systemtags:note.systemtags});
        } else if ($src.hasClass("published-toggle")) {
            openURLinTab("https://simple-note.appspot.com/publish/"+note.publishkey, event.ctrlKey || event.altKey );
             // bind published click
        } else if ($src.hasClass("shared-toggle")) {
            openURLinTab("https://simple-note.appspot.com/#note="+note.key, event.ctrlKey || event.altKey );
        } else if ($src.hasClass("webnote-icon")) {
            var wnm = note.content.match(extData.webnotereg);
            if (wnm)
                openURLinTab(wnm[1], event.ctrlKey || event.altKey );
        }

        event.stopPropagation();
        event.preventDefault();

    }

    function noteRowClickHandler(event) {
        if (event.which != 1) {
            return;
        }

        var $src = $(event.srcElement);
        var note = that.getNote($src.parent(".noterow").attr("id"));
        if (!note)
            note = that.getNote($src.attr("id"));

        if (note.deleted == 0) {

            if (extData.isTab && snEditor.note) {
                if (snEditor.note.key == note.key)
                    return;
                //snEditor.saveCaretScroll();
            }

            $("#notes div.noterow").removeClass("selectednote");
            $("#" + note.key).addClass("selectednote");
            snEditor.setNote(note);

        } else {
            snHelpers.untrashNote(note.key);
        }
    }
}

SNNotelist.prototype.slide = function(to) {
    if ($("#index div.noterow:visible").length == 0)
        $("#index div.noterow").each(function(i,e){$(e).show().delay(i*20).animate({left: 0},{complete: function() {}});});
    else
        snHelpers.getInView("#index div.noterow").each(function(i,e){$(e).delay(i*20).animate({left: 800},{complete: function() {$(".noterow").stop().hide()}});});
}

SNNotelist.prototype.getNote = function(key) {
    return this.notes.filter(function(n) {return n.key == key})[0];
}

SNNotelist.prototype.request = function(useLS) {
    tick("requestNotes");
    var that = this;

    var req =               {action : "getnotes", deleted : 0};
    req     = mergeobj(req, {tag : this.snIndex.snToolbar.snTagselect.indextag});
    req     = mergeobj(req, {contentquery : $('#q').val()});
    req     = mergeobj(req, {sort:localStorage.option_sortby, sortdirection:localStorage.option_sortbydirection});
    if ((localStorage.option_hidewebnotes == undefined || localStorage.option_hidewebnotes == "true") && (req.tag == "" || req.tag == "#all#"))
        req     = mergeobj(req, {notregex: extData.webnoteregstr});

    //log("requestNotes: " + JSON.stringify(req));
    if (!useLS)
        chrome.extension.sendRequest(req, function(notes) {
            try {

                that.fillWith(notes);

            } catch (e) {
                exceptionCaught(e);
            }
        });
    else
        this.fillWith(SimplenoteLS.getNotes(req));
}

SNNotelist.prototype.fillWith = function(notes) {
    tock("buildNoteList");

    var addContent = true;

    this.notes = notes;

    if (extData.isTab || extData.currentView == "index")
        $("#index").show();

    var note, noteshtmlary=[];

    this.$ui.unbind("scroll");

    if (notes.length > 0) {

        for( var i = 0; i < notes.length; i ++ ) {
            note = notes[i];
            noteshtmlary.push(this.noteRawHTML(note, (i<15 || addContent) && note.content != undefined));
            // need for scroll selected into view
            if (snLastOpen.isKey(note.key))
                addContent = false;
        }

        this.$ui.html(noteshtmlary.join(""));

        tock("buildNoteList: notes html");

        this.$ui.find("div.noterow").contextMenu(noteRowCMfn, {
                                                      theme:'gloss',
                                                      offsetX: 0,
                                                      offsetY: 0,
                                                      direction:'down',
                                                      showSpeed: 10,
                                                      onBeforeShow:function() {
                                                          $(this.target).addClass("highlightednote");
                                                      },
                                                      hideSpeed:10,
                                                      onBeforeHide:function() {
                                                          $(this.target).removeClass("highlightednote");
                                                      },
                                                      delegate: "div#notes",
                                                      otherBodies: extData.isTab?function() {return snEditor.$CMbody()} :null,
                                                      scrollRemove: "div#notes"
                                              }).show();

        this.$ui.show();

        tock("buildNoteList: notes show");

        // bind timeago for time abbr
        if (localStorage.option_showdate == "true")
            $("#index abbr.notetime").timeago();

        snHelpers.checkInView();
    } else
        this.$ui.html("<div id='nonotes'>" + chrome.i18n.getMessage("no_notes_to_show") + "</div>");

    if (this.scrolltoselected)
        snHelpers.scrollSelectedIntoView();

    this.$ui.scroll(snHelpers.checkInView);

    snEditor.hideIfNotInIndex();


    // log stuff
    extData.times.endfillindex= (new Date())-start;
    if (!extData.sentTimeBeacon) {
        log("requestNotes(async):sending time beacon");
         _gaq.push(['_trackEvent', 'popup', 'ready', 'endfillindex',extData.times.endfillindex]);
         extData.sentTimeBeacon = true;
        snHelpers.printTimes();
    }

    tock("buildNoteList end");

    //this.snIndex.snToolbar.setHeight(65);

    function noteRowCMfn(contextmenu) {

        var notename = $("#" + $(contextmenu.target).attr("id") + "heading").text();
        var istrash = $(contextmenu.target).hasClass("noterowdeleted");

        var i = {};
        if (!istrash) {
            i[chrome.i18n.getMessage("trash_tooltip","")] = {
                onclick: function() {
                    _gaq.push(['_trackEvent', 'popup', 'cm', 'trash']);
                    snHelpers.trashNote($(this).attr("id"));
                },
                icon: "/images/trash.png"
            };
            var j = {};
            j[chrome.i18n.getMessage("finally_delete")] = {
                onclick: function() {
                    _gaq.push(['_trackEvent', 'popup', 'cm', 'finally_delete']);
                    if (confirm("Permanently delete note '" + notename + "'?"))
                        chrome.extension.sendRequest({action : "update", key : $(this).attr("id"), deleted: 1},
                            function(note) {
                                chrome.extension.sendRequest({action : "delete", key : note.key},
                                    function() {
                                        snEditor.hideIfNotInIndex(key);
                                        snHelpers.checkInView();
                                    });
                            });
                },
                icon: "/images/delete.gif"
            };
            return [i,j];
        } else {
            i[chrome.i18n.getMessage("recover_from_trash")] = {
                onclick: function() {
                    _gaq.push(['_trackEvent', 'popup', 'cm', 'recover_trash']);
                    snHelpers.untrashNote($(this).attr("id"));
                },
                icon: "/images/untrash.png"
            };
            var j = {};
            j[chrome.i18n.getMessage("finally_delete")] = {
                onclick: function() {
                    _gaq.push(['_trackEvent', 'popup', 'cm', 'finally_delete']);
                    if (confirm("Permanently delete note '" + notename + "'?"))
                        chrome.extension.sendRequest({action : "delete", key : $(this).attr("id")},
                            function() {
                                snEditor.hideIfNotInIndex(key);
                                snHelpers.checkInView();
                            });
                },
                icon: "/images/delete.gif"
            };
            var k = {};
            k[chrome.i18n.getMessage("empty_trash")] = {
                onclick: function() {
                    _gaq.push(['_trackEvent', 'popup', 'cm', 'empty_trash']);
                    if (confirm("Empty trash?"))
                        chrome.extension.sendRequest({action : "emptytrash"},
                            function() {
                                //requestTags(true);
                            });
                }
            };
            return [i,j,$.contextMenu.separator,k];
        }

    }

}

SNNotelist.prototype.noteRawHTML = function(note, addcontent, show) {

    var note = new Note(note);

    var date, prefix, shareds = [];
    var rowtitle = "", pintitle = "", sharetitle = "", headingtext = "", headinghtml = "", headingtitle = "", html = "", abstracthtml = "", url = "";
    var rowstyles = show?[]:["display:none"], thisclasses = ["noterow"];

    addcontent &= (note.content != undefined);

    if (!addcontent) {
         thisclasses.push("nocontent");
         rowstyles.push("height: " + (20 + this.storage.option_abstractlines*14) + "px");
    } else {
        var lines = note.content.split("\n").filter(function(line) {
            return ( line.trim().length > 0 && !line.match(extData.webnotereg))
        });

        // set actual heading
        headingtext = lines[0] != undefined?lines[0].trim():" ";
        headinghtml = htmlEncode(headingtext,100);

        if (headingtext.length > 25 && note.deleted != 1)
            headingtitle = headingtext;

        // abstract
        if (this.storage.option_abstractlines>=0)
            abstracthtml = lines.slice(1,Math.min(lines.length,this.storage.option_abstractlines*1+1));
        else // -1 ~ all
            abstracthtml = lines;
        // set actual abstract

        abstracthtml = htmlEncode(abstracthtml,100).join("<br/>");

        var wnm = note.content.match(extData.webnotereg);
        if (wnm ) {
            url = wnm[1];
            abstracthtml = "[" + url + "]<br>" + abstracthtml;
        }
    }
    // unread
    if (note.systemtags.indexOf("unread")>0)
         thisclasses.push("unread");
    // tab selected
    //if (this.extData.isTab && this.snEditor.note && this.snEditor.note.key == note.key) {
    if (snLastOpen.isKey(note.key)) {
        thisclasses.push("selectednote");
    }
    if (note.deleted == 1) {
        thisclasses.push("noterowdeleted");
        rowtitle = " title='" + this.click_to_undelete + "'";
    } else {
        pintitle = " title='" + this.click_to_pinunpin + "'";
    }

    if (note._score != undefined) {
        //html = note._score + " - " + html;
        if (note._score >= 1)
            thisclasses.push("fullhit");
        if (note._score < 1)
            thisclasses.push("partialhit");
    }


    var sortattrs = " modifydate='" + note.modifydate + "'";
    sortattrs += " createdate='" + note.createdate + "'";
    sortattrs += " notetitle='" + note.title() + "'";
    sortattrs += " version='" + note.version + "'";
    sortattrs += " syncnum='" + note.syncnum + "'";
    sortattrs += " pinned='" + note.isPinned() + "'";

    // assemble noterow html string
    html = "<div class='" + thisclasses.join(" ") + "' id='" + note.key  + "' style='" + rowstyles.join(";") + "'" + rowtitle + sortattrs + ">";
    // #syncicon
    if (note.isSyncNote())
        html+=          "<div class='syncnote-icon statusicon active' title='" + this.syncnote_tooltip + "'></div>";
    else
        html+=          "<div class='syncnote-icon statusicon'></div>";
    // #time abbr
    if (this.storage.option_showdate == "true") {
        if (this.storage.option_sortby == "createdate") {
            date = convertDate(note.createdate);
            prefix = this.created;
        } else {
            date = convertDate(note.modifydate);
            prefix = this.modified;
        }

        html+=          "<abbr class='notetime' title='" + ISODateString(date) + "'>" + prefix + localeDateString(date) + "</abbr>";
    }
        // #pin
        html+=          "<div class='pin-toggle statusicon-clickable" + (note.isPinned()?" active":"") + "'" + pintitle + "></div>";
        // #published
        if (note.publishkey) {
            html+=      "<div class='published-toggle statusicon-clickable active' title='" + this.published_tooltip + "'></div>";
        } else {
            html+=      "<div class='published-toggle statusicon-clickable'></div>";
        }
        // #shared
        if (note.systemtags.indexOf("shared") >= 0) {

            for (var i=0;i<note.tags.length;i++) {
                if (validateEmail(note.tags[i])) {
                    shareds.push(note.tags[i]);
                }
            }
            if (shareds.length > 0)
                sharetitle = this.sharer_tooltip + " " + shareds.join(", ");
            else
                sharetitle = this.sharee_tooltip;
        }

        if (sharetitle)
            html+=  "<div class='shared-toggle statusicon-clickable active' title='" + sharetitle + "'></div>";
        else
            html+=  "<div class='shared-toggle statusicon-clickable'></div>";


        if (addcontent && url != "") {
            html += "<div class='webnote-icon statusicon-clickable active'" + (note.deleted == 0?" title='" + chrome.i18n.getMessage("webnote_icon",url) + "'":"") + "></div>";
        } else {
            html += "<div class='webnote-icon statusicon-clickable'></div>";
        }

    // #heading
    html+=              "<div class='noteheading'" + (headingtitle != ""?" title='" + headingtitle + "'":"") + "> " + headinghtml + "</div>";
    // #abstract
    html+=              "<div class='abstract'>" + abstracthtml + "</div>";

    //html+=              "<div class='sortkey'></div>";

    html+="</div>";

    return html;

    // encode string or string array into html equivalent
    function htmlEncode(s, maxchars)
    {
        if (!s)
            return "";
        if (!maxchars)
            maxchars = 1000000;

        if (s instanceof Array)
            return s.map(function(s) {
                return htmlSafe(s.substring(0,maxchars)).replace(/\n/g,"<br>").replace(/\s/g,"&nbsp;");
            });
        else
            return htmlSafe(s.substring(0,maxchars)).replace(/\n/g,"<br>").replace(/\s/g,"&nbsp;");
    }

    // make string html safe
    function htmlSafe(s) {
        return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }

    //  ---------------------------------------
    function ISODateString(d) {
        return d.getUTCFullYear()+'-'+pad(d.getUTCMonth()+1)+'-'+ pad(d.getUTCDate())+'T'+ pad(d.getUTCHours())+':'+ pad(d.getUTCMinutes())+':'+ pad(d.getUTCSeconds())+'Z'
    }
    //  ---------------------------------------
    function localeDateString(d) {
        var s = d.toLocaleString();
        return s.substring(0, s.indexOf("GMT")-1);
    }
}

SNNotelist.prototype._sortBy = function(what, direction) {
    tick();
    if(direction == undefined) direction = 1;

//    $("#notes div.noterow").each(function(i,e) {
//        $("div.sortkey",e).html($(e).attr(what));
//    })
    var comparator;

    switch(what) {
        case "notetitle":
            comparator = function($a,$b) {
                return $b.attr(what) < $a.attr(what)?direction:-1*direction;
            };
            break;
        default:
            comparator = function($a,$b) {
                return ($b.attr(what) - $a.attr(what))*direction;
            };
            break;
    }


    var $notes = $("#notes");
    var $last = null;
    $("#notes div.noterow")
                .sort(function(a,b) {
                    var $a=$(a), $b=$(b);
                    var d = ($b.attr("pinned")=="true"?1:0) - ($a.attr("pinned")=="true"?1:0);

                    if (d==0)
                        return comparator($a,$b)
                    else
                        return d;

                })
                .each(function(i){
                    // at this point the array is sorted, so we can just detach each one from wherever it is, and add it after the last
                    var node = $(this);
                    if ($last) {
                        $last.after(node);
                    } else {
                        $notes.prepend(node);
                    }
                    $last = node;
                });


    snHelpers.checkInView();
    tock("sorted");
}

SNNotelist.prototype.setSort = function(what, dir) {
    if (this.sort == what)
        return;

    this.sort = what;
    this.sort_dir = dir;
    this.reSort();
}
SNNotelist.prototype.reSort = function() {
    this._sortBy(this.what,this.dir);
}

//  ---------------------------------------
function slideEditor(callback, duration) {
    log("slideEditor, duration " + duration);

    if (duration == undefined)
        duration = extData.slideDuration;

    snEditor.show();

    if (!extData.isTab) {
        $('#index').animate({left: extData.dimensions.focus.index_left + "px", right: extData.dimensions.focus.index_right + "px"}, {duration: duration, easing: extData.slideEasing});
        $('#note').animate({left: extData.dimensions.focus.note_left + "px"}, {duration: duration, easing: extData.slideEasing});
        $('body').animate({width : extData.dimensions.focus.body_width + "px"}, {duration: duration, easing: extData.slideEasing,
           complete: function() {
                if (callback) callback();
            }
        });

    } else
        if (callback) callback();

    extData.currentView = "editor";

}
//  ---------------------------------------
function slideIndex(callback, duration) {
    log("slideIndex");

    if (duration == undefined)
        duration = extData.slideDuration;

    snLastOpen.dontOpen();
    snEditor.clearDirty();
    snEditor.saveCaretScroll();

    $("#index").show();
    $("#markdowninfo").hide();
    if (!extData.isTab) {
        $('#note').animate({left: extData.dimensions.def.note_left + "px"}, {duration:duration, easing: extData.slideEasing});
        $('#index').animate({left: extData.dimensions.def.index_left + "px", right: extData.dimensions.def.index_right + "px"}, {duration: duration, easing: extData.slideEasing});

        $('body').animate({width : extData.dimensions.def.body_width + "px"}, {duration: duration, easing: extData.slideEasing,
            complete: function() {
                if (callback) callback();
            }
        });
    } else
         if (callback) callback();

    extData.currentView = "index";

    delete snEditor.note;
}

//  ---------------------------------------
//  SNEditor
//  ---------------------------------------

function SNEditor(onLoad) {
    log("SNEditor:create");
    this.codeMirror = new CodeMirror(document.getElementById("note"),{
                    parserfile: "/javascripts/simplenoteParser.js",
                    path: "/javascripts/lib/codemirror1/",
                    iframeClass: "cm-iframe",
                    content: "",
                    stylesheet: "/stylesheets/editor.css",
                    tabMode: "shift",
                    indentUnit: 4,
                    enterMode: "keep",
                    electricChars : false,
                    //addscripts : ["/javascripts/lib/sscr.js","/javascripts/lib/middlemouse.js"],
                    onLoad: onLoad?onLoad:function() {}
                });

    // set ids for important nodes
    $(".cm-iframe").attr("id","cmiframe");
    $(".CodeMirror-wrapping").attr("id","cmwrapper");

    $("#cmwrapper").css("position","");
    $("#cmwrapper").css("height","");
    $("#cmiframe").attr("tabindex","2");
    $("#cmwrapper").append("<div id='markdownpreviewspacer'></div>");
    $("#cmwrapper").append("<div id='markdownpreview'><span id='markdowninfo'></span></div>");

    this.dirty={content: false, tags: false, pinned: false};

}

SNEditor.prototype.$CMbody = function () {
    return $(this.codeMirror.editor.container);
}

SNEditor.prototype.$CMhead = function () {
    return $(this.codeMirror.editor.container.ownerDocument.head);
}

//  ---------------------------------------
SNEditor.prototype.setFont = function() {
    log("SNEditor.setFont")
    var $head = this.$CMhead();
    var $editbox = this.$CMbody();
    // get fontinfo if there
    var fontinfo;
    if (localStorage.editorfontinfo)
        fontinfo = JSON.parse(localStorage.editorfontinfo);

    // inject font url
    // keeping this so we can easily delete already loaded fonts
    // otherwise could add a fontinfo field for url
    var fontname = localStorage.option_editorfont?localStorage.option_editorfont:fontinfo.family;
    for(var name in extData.fontUrls) {
        if (fontname == name) {
            $head.append(extData.fontUrls[name]);
            delete extData.fontUrls[name];
            break;
        }
    }
    // set font properties
    if (fontinfo) {
        $editbox.css("font-family",fontinfo.family);
        $editbox.css("font-size",fontinfo.size);
        $editbox.css("letter-spacing",fontinfo.letter_spacing);
        $editbox.css("word-spacing",fontinfo.word_spacing);
        $editbox.css("line-height",fontinfo.line_height);
    } else {
        $editbox.css("font-family", localStorage.option_editorfont);
        $editbox.css("font-size", localStorage.option_editorfontsize);
    }

    // set font shadow
    if (localStorage.option_editorfontshadow && localStorage.option_editorfontshadow != "false") {
       if (localStorage.option_editorfontshadow == "true")
           $editbox.css("text-shadow","0px 0px 1px #ccc" );
       else
           $editbox.css("text-shadow", localStorage.option_editorfontshadow);
    }
    //
    // set colors
    if (localStorage.option_color_editor) {
        $("#cmiframe").css("background-color",localStorage.option_color_editor);
    }
    if (localStorage.option_color_editor_font)
        $editbox.css("color",localStorage.option_color_editor_font);


    if (localStorage.option_gpuaccel == "true") {
        $editbox.css("-webkit-transform","translateZ(0)");
        $("#markdownpreview").css("-webkit-transform","translateZ(0)");
        $("#markdownpreviewspacer").css("-webkit-transform","translateZ(0)");
    }
}
//  ---------------------------------------
SNEditor.prototype.getTags = function() {
    log("SNEditor.getTags")

    var vals = $("#as-selections-tagsauto li.as-selection-item").get().map(function(e) {return e.textContent.substr(1)});
    var tags = vals.map(function(e) {return e.trim();}).filter(function(e) {return e != ""});

    return tags;
}

//  ---------------------------------------
SNEditor.prototype.initialize = function() {

    if (this.initialized)
        return;

    log("SNEditor.intitalize");

    this.holdmarkdownscroll = false;

    try {

        var $editbox = this.$CMbody();
        var that = this;
        var line;

        // add note content change (dirty) event listeners

        $editbox.unbind();
        $editbox.bind('change keyup paste cut', function(event) {
            console.log(event.type)
            that.setDirty("content", that.note.content != that.codeMirror.getCode(), event);
            if (that.isMarkdownToggle() && that.isPreviewtoggle()) {
                that.updateMarkdown();
                that.syncScrolls("fromeditor");
            }
        });

        // fix for home not scrolling all to the left
        $editbox.keydown(shortcutListener);
        $editbox.bind("keydown keyup",function(event) {
            //alert(event.keyCode)
            switch(event.keyCode) {
                case 36: //home key
                    $editbox.scrollLeft(Math.max(0,$editbox.scrollLeft()-300));
                    if (event.ctrlKey)
                        $editbox.scrollTop(Math.max(0,$editbox.scrollTop()-30));
                    break;
                case 35: //end key
                    if (event.ctrlKey) {
                        $editbox.scrollTop($editbox.scrollTop() + 20);
                        $editbox.scrollLeft(Math.max(0,$editbox.scrollLeft()-300));
                    }
                    break;
                case 37: //left key
                    var pos = that.codeMirror.cursorPosition(true);
                    if (pos.character == 0)
                        $editbox.scrollLeft(0);
                    break;
                case 38: //up key
                    line = that.codeMirror.lineNumber(that.codeMirror.cursorLine());
                    if (line == 1)
                        $editbox.scrollTop(0);
                    break;
                case 40: //down key
                    if (that.codeMirror.lastLine() == that.codeMirror.cursorLine())
                        $editbox.scrollTop($editbox.scrollTop() + 20);
                    break;
                case 191: // #-key
                    //alert(JSON.stringify(that.codeMirror.cursorCoords(true)))
                    //dropdown(that.codeMirror,["asd","dfg","asdkj"]);
                    break;
            }
        });

        // add note pinned (dirty) event listener
        $('#pintoggle').unbind();
        $('#pintoggle').bind('click', function(event) {

            _gaq.push(['_trackEvent', 'popup', 'pintoggled']);

            snEditor.setPintoggle(!snEditor.isPintoggle());

            var changed = that.setDirty("pinned", (that.note.systemtags.indexOf("pinned")>=0) != snEditor.isPintoggle() , event);

            if (changed && extData.isTab)
                that.saveNote();

            that.focus();
        });

        // add note markdown event listener
        $('#markdowntoggle').unbind();
        $('#markdowntoggle').bind('click', function(event) {

            _gaq.push(['_trackEvent', 'popup', 'markdowntoggled']);

            snEditor.setMarkdownToggle(!snEditor.isMarkdownToggle());

            var changed = that.setDirty("markdown", (that.note.systemtags.indexOf("markdown")>=0) != snEditor.isMarkdownToggle() , event);

            if (changed && extData.isTab)
                that.saveNote();

            that.focus();

        });

        // bind back button
        $('#backtoindex').unbind();
        $('#backtoindex').click(function(event) {
            if (that.isNoteDirty())
                that.saveNote();

            slideIndex();
        });

        // bind word wrap
        $("#wraptoggle").unbind();
        $("#wraptoggle").bind('click', function(event) {

            _gaq.push(['_trackEvent', 'popup', 'wordwraptoggled']);

            that.setWraptoggle(!that.isWraptoggle());

            localStorage.wordwrap = that.isWraptoggle();
            that.codeMirror.setTextWrapping(that.isWraptoggle());
            that.focus();
        });
        this.setWraptoggle(localStorage.wordwrap != undefined && localStorage.wordwrap == "true");
        this.codeMirror.setTextWrapping(this.isWraptoggle());

        // bind preview toggle
        $("#previewtoggle").unbind();
        $("#previewtoggle").bind('click', function(event) {

            _gaq.push(['_trackEvent', 'popup', 'previewtoggled']);

            that.setPreviewtoggle(!that.isPreviewtoggle());

            localStorage.markdown_preview = that.isPreviewtoggle();
            that.focus();
        });
        this.setPreviewtoggle(localStorage.markdown_preview == undefined || localStorage.markdown_preview == "true");
        this.setPreviewPane();

        // bind UNDO button
        $('#revert').unbind();
        $('#revert').click(function(event) {
            // reset content
            log("SNEditor.initialize:undo clicked");

            _gaq.push(['_trackEvent', 'popup', 'undoclicked']);

            var note = that.note;
            if (that.dirty.content) {
                //that.saveCaretScroll();
                that.codeMirror.setCode(note.content);
                that.updateMarkdown();
                that.restoreCaretScroll();
            }
            // reset tags
            if (that.dirty.tags)
                that.setupTags();

            // reset pinned
            if (that.dirty.pinned) {
                that.setPintoggle(note.systemtags.indexOf("pinned")>=0);
            }

            if (that.dirty.markdown) {
                that.setMarkdownToggle(note.systemtags.indexOf("markdown")>=0);
            }

            that.hideRevert();

            that.clearDirty(); // should not dont need this here b/c of callbacks
            that.focus();
        });

        // bind DELETE/CANCEL
        $('#trash').unbind();
        $('#trash').click(function() {
            _gaq.push(['_trackEvent', 'popup', 'trashclicked']);
            that.trashNote();
            slideIndex();
        });

        // bind PRINT
        if (extData.isTab) {
            $('#print').unbind();
            $('#print').click(function() {
                _gaq.push(['_trackEvent', 'popup', 'printclicked']);
                that.print();
            });
            $('#print').show();
        }

        // bind link clicks
        $("span.sn-link",$editbox).die();
        $("span.sn-link",$editbox).live("click",function(event) {
           if (event.ctrlKey) {
               _gaq.push(['_trackEvent', 'popup', 'linkclicked_unhot']);
               return;
           }
           _gaq.push(['_trackEvent', 'popup', 'linkclicked']);
           var url = this.textContent.trim();
           openURLinTab(url,event.shiftKey || event.altKey);
        });

        // bind checkboxes
        $("span.checkbox",$editbox).die();
        $("span.checkbox",$editbox).live("click",function(event) {
           var lineH = that.codeMirror.cursorLine();
           var line = that.codeMirror.lineContent(lineH);
           var m = line.replace(/\s*\-\s*(.*)/,"* $1");
           $(this,$editbox).removeClass("checkbox").addClass("checkbox-checked");
           that.codeMirror.setLineContent(lineH,m);
           that.codeMirror.selectLines(lineH,3);

           that.setDirty("content", that.note.content != that.codeMirror.getCode(), event);
           that.saveTimerRearm();
        });

        $("span.checkbox-checked",$editbox).die();
        $("span.checkbox-checked",$editbox).live("click",function(event) {
           var lineH = that.codeMirror.cursorLine();
           var line = that.codeMirror.lineContent(lineH);
           var m = line.replace(/\s*\*\s*(.*)/,"- $1");
           $(this,$editbox).removeClass("checkbox-checked").addClass("checkbox");

           that.codeMirror.setLineContent(lineH,m);
           that.codeMirror.selectLines(lineH,3);

           that.setDirty("content", that.note.content != that.codeMirror.getCode(), event);
           that.saveTimerRearm();

        });

        $("span.sn-link-note",$editbox).die();
        $("span.sn-link-note",$editbox).live("click",function(event) {
            if (event.ctrlKey) {
               _gaq.push(['_trackEvent', 'popup', 'linkclicked_unhot']);
               return;
            }
            var title = this.textContent.trim().substr(1).replace(/_/g," ");
            var titles = extData.headings.filter(function(h) {return h.title == title;});
            if (titles.length >= 1) {
                if (extData.isTab && that.note)
                        that.saveCaretScroll();

                that.setNote(titles[0]);
            }
        });

        // bind ctrl link disable
        $editbox.bind('keydown', function(event) {
            if (event.keyCode == 17) // ctrl
                $("[class^=sn-link]",$editbox).addClass("sn-link-unhot");
        });
        // bind ctrl link disable disable
        $editbox.bind('keyup', function(event) {
            if (event.keyCode == 17) // ctrl
                $("[class^=sn-link]",$editbox).removeClass("sn-link-unhot");
        });

        $("#markdownpreview").scroll(function (event) {
            if (that.holdmarkdownscroll) {
                that.holdmarkdownscroll = false;
                return;
            }
            if ($(this).css("left") == "0%")
                return;
        }).click( function (event) {
            if (event.which == 1)
                $("#markdownpreviewspacer").click();
        }).bind("mousewheel", function(event) {

            //console.log("mousewheel %s", event.wheelDelta);
            event.stopPropagation();
            that.syncScrolls("","mousewheel",event.wheelDelta);
        });

        $("#markdownpreviewspacer").click(function() {
            $("#markdownpreviewspacer").toggleClass("max");
            $("#markdownpreview").toggleClass("max");
            var scrollBefore = $("#markdownpreview").scrollTop()/$("#markdownpreview").get(0).scrollHeight;

            if ($("#markdownpreviewspacer").hasClass("max"))
                $("#cmiframe").hide(300, function() {
                    $("#markdownpreview").scrollTop($("#markdownpreview").get(0).scrollHeight * scrollBefore);
                });
            else
                $("#cmiframe").show(300, function() {
                    $("#markdownpreview").scrollTop($("#markdownpreview").get(0).scrollHeight * scrollBefore);
                });

            return;
        });

        if (!extData.isTab)
            $('#popout').click(function(event) {
                _gaq.push(['_trackEvent', 'popup', 'popoutclicked']);
                chrome.tabs.create({url:chrome.extension.getURL("/popup.html?tab=true"), pinned:localStorage.option_pinnedtab == undefined || localStorage.option_pinnedtab == "true"}, function(tab) {
                    extData.background.SimplenoteBG.setOpenTab(tab);
                });
            });
        else {
            $('#popout').hide();
            $('#backtoindex').unbind().click(function(event) {
                window.close();
            });
        }
        // add context menu
        this.makeContextMenu();

        this.initialized = true;


    } catch (e) {
        exceptionCaught(e);
    }

}

SNEditor.prototype.scrollEditorTo = function(scroll) {
    var deltaX = scroll.left - this.codeMirror.editor.container.scrollLeft;
    var deltaY = scroll.top - this.codeMirror.editor.container.scrollTop;
    this.codeMirror.win.scrollArray(this.codeMirror.editor.container, deltaX, deltaY);
}

SNEditor.prototype.scrollPreviewTo = function(scroll) {
    var mdp = $("#markdownpreview").get(0);
    scrollArray(mdp, scroll.left - mdp.scrollLeft, scroll.top - mdp.scrollTop);
}

SNEditor.prototype.syncScrolls = function(direction, method, delta) {
    var source, target, sourceScroll, $mdp = $("#markdownpreview");

    log("syncscroll")

    if (!$mdp.is(":visible"))
        return;

    if (direction == "fromeditor") {
        source = this.$CMbody().get(0);
        target = $mdp.get(0);
        this.holdmarkdownscroll = true;
    } else {
        target = this.$CMbody().get(0);
        source = $mdp.get(0);
    }

    if (method == "mousewheel") {
        var newST = (source.scrollTop-delta) * (target.scrollHeight - source.clientHeight) / (source.scrollHeight - source.clientHeight);

        //console.log("(%s - %s)*(%s - %s)/(%s-%s) = %s", source.scrollTop, delta, target.scrollHeight, target.clientHeight, source.scrollHeight, source.clientHeight, newST)

        this.scrollEditorTo({top: newST, left: 0});
        this.scrollPreviewTo({top: source.scrollTop-delta, left: 0});
    } else {

        var newST = source.scrollTop * (target.scrollHeight - target.clientHeight) / (source.scrollHeight - source.clientHeight);

        $(target).scrollTop(Math.round(newST));

    }
}

//  ---------------------------------------
SNEditor.prototype.saveCaretScroll = function() {
    log("SNEditor.saveCaretScroll");
    if (!this.note)
        return;

    var caretScroll = this.codeMirror.cursorPosition();
    caretScroll.line = this.codeMirror.lineNumber(caretScroll.line);
    caretScroll.scrollTop = this.$CMbody().scrollTop();
    caretScroll.scrollLeft = this.$CMbody().scrollLeft();
    localStorage[this.note.key + "_caret"] = JSON.stringify(caretScroll);
    cs2str("saved",caretScroll);
}

//  ---------------------------------------
SNEditor.prototype.restoreCaretScroll = function (caretScroll) {
    log("SNEditor.restoreCaretScroll")
    if (!this.note)
        return;

    if (!caretScroll && localStorage[this.note.key + "_caret"] && (localStorage.option_remembercaret == undefined || localStorage.option_remembercaret == "true"))
        caretScroll = JSON.parse(localStorage[this.note.key + "_caret"]);

    if ( caretScroll != undefined ) {

        var lineH;
        if (caretScroll.line == "lastline")
            lineH = this.codeMirror.lastLine();
        else {
            lineH = this.codeMirror.nthLine(caretScroll.line);
            if (!lineH)
                lineH = this.codeMirror.lastLine();
        }
        var character = Math.min(this.codeMirror.lineContent(lineH).length,caretScroll.character);

//        cs2str("target     ",caretScroll);

//        this.logCaretScroll("before curso");
        this.codeMirror.selectLines(lineH, character);

        if (caretScroll.scrollTop != undefined)
            this.$CMbody().scrollTop(caretScroll.scrollTop);
        if (caretScroll.scrollLeft != undefined)
            this.$CMbody().scrollLeft(caretScroll.scrollLeft);

//        this.logCaretScroll("after ");
        this.syncScrolls();
    }
}

SNEditor.prototype.logCaretScroll = function(msg) {
    var pos = snEditor.codeMirror.cursorPosition();
    pos.line = snEditor.codeMirror.lineNumber(pos.line);
    cs2str(msg,pos,this.$CMbody());
}

function cs2str(msg,p,$elm) {
    if ($elm) {
        p.scrollTop = $elm.scrollTop();
        p.scrollLeft = $elm.scrollLeft();
    }
    log(msg + ": line " + p.line + ", char " + p.character + ", sTop " + p.scrollTop + ", sLeft " + p.scrollLeft);
}

//  ---------------------------------------
SNEditor.prototype.insertUrl = function() {
    log("SNEditor.insertUrl")
    _gaq.push(['_trackEvent', 'popup', 'insertUrl']);

    var that = this;
    chrome.tabs.getSelected(undefined,function(tab) {
        that.codeMirror.replaceSelection(tab.url);
        that.saveTimerRearm();
    });
}

//  ---------------------------------------
SNEditor.prototype.searchForSelection = function () {
    log("SNEditor.searchForSelection")
    if (this.codeMirror.selection().trim() != "") {
        _gaq.push(['_trackEvent', 'popup', 'searchForSelection']);
        openURLinTab("http://google.com/search?q=" + encodeURIComponent(this.codeMirror.selection().trim()));
    }
}

//  ---------------------------------------
SNEditor.prototype.hideIfNotInIndex = function (key) {
    if (!extData.isTab)
        return;

    log("SNEditor.hideIfNotInIndex")

    var keys = $("#index div.noterow").map(function(i,e) {
        if ($(this).attr("deleteanimation") == "true")
            return "";
        else
            return this.id;
    }).filter(function(e) {return e.id != "";}).get();

    if (!this.note || (this.note.key != "" && keys.indexOf(this.note.key)<0)) {
        if (keys.length > 0) {
            key = key?key:keys[0];
            chrome.extension.sendRequest({action:"note", key:key}, function(note) {
                if (note && note.deleted != 1) {
                    //that.setNote(note,{focus:false});
                } else
                    $("#note").hide();
                });
        } else
            $("#note").hide();
    } else if (this.note)
        this.show();

    if ($('#q').val() == "")
        snHelpers.scrollSelectedIntoView();
}

//  ---------------------------------------
SNEditor.prototype.show = function() {
    $("#note").show();
}

SNEditor.prototype.focus = function() {
    this.$CMbody().focus();
}

//  ---------------------------------------
SNEditor.prototype.makeContextMenu = function() {

    log("SNEditor.makeContextMenu")

    var that = this;
    this.$CMbody().contextMenu(
        function() {
            var i = {};
            i[chrome.i18n.getMessage("editorcm_insert_url","alt-v")] = {
                onclick: function() {that.insertUrl();},
                disabled: extData.isTab
            };
            var s = {};
            s[chrome.i18n.getMessage("editorcm_search_selection","alt-s")] = {
                onclick: function() {that.searchForSelection();},
                disabled: that.codeMirror.selection().trim() == "",
                icon: "/images/searchfield.png"
            };
            return [i,s];
        },
        {
            theme:'gloss',
            offsetX: extData.isTab?446:6,
            offsetY: extData.isTab?78:38,
            direction:'down',
            otherBodies: $(extData.popup),
            scrollRemove: "#cmiframe"
        }
    );
}

//  ---------------------------------------
SNEditor.prototype.setNote = function(note, options) {

    // new note dummy data
    if (note==undefined)
        note = {content:"",tags:[],systemtags:[], key:""};

    if (!options)
        options = {};

    if (options.focus === undefined)
        options.focus = true;
    if (options.isnewnote === undefined)
        options.isnewnote = false;

    log("SNEditor.setNote: " + note.key);

    var that = this;
    if (this.isNoteDirty()) {
        this.saveNote();
        this.clearDirty();
        this.setNote(note, options);
        return;
    }

    var inputcontent = note.content;


    this.setFont();
    this.initialize();

    this.note = note;
    if (options.isnewnote)
        this.note.content = "";

    // get note contents
    if (note.key == "") { // new note

        $("#trash").hide();
        $('#popout').hide();

    } else { // existing note

        $("#trash").show();

        if (!extData.isTab) {
            $('#popout').show();
        }

        snLastOpen.openTo(note.key);

        this.needCMRefresh("lastopen");
    }

    // set content
    //that.codeMirror.setParser("SimpleParser", {checklist: that.note.tags.indexOf("Checklist") >= 0 ? ["-","*"] : false});
    that.codeMirror.setParser("SimpleParser", {headings: [], checklist: that.note.tags.indexOf("Checklist") >= 0 ? ["-","*"] : false, wikilinks : true});
    that.codeMirror.setCode(inputcontent);

    snHelpers.getHeadings(false,function(headings) {
        that.codeMirror.setParser("SimpleParser", {headings: headings, checklist: that.note.tags.indexOf("Checklist") >= 0 ? ["-","*"] : false, wikilinks : true});
    })

    // set pinned
    this.setPintoggle(this.note.systemtags.indexOf("pinned")>=0);

    // set markdown
    this.clearMarkdown();
    this.setMarkdownToggle(this.note.systemtags.indexOf("markdown") >= 0);
    this.updateMarkdown();

    this.clearDirty();

    if (options.isnewnote) {
        this.setDirty("content", true, null);
    } else
        this.hideRevert();

    // looks better
    $("#as-selections-tagsauto").remove();
    $("#as-results-tagsauto").remove();

    slideEditor(function () {

        that.setupTags();

        if (note.systemtags.indexOf("unread")>0) {

            note.systemtags.splice(note.systemtags.indexOf("unread"),1);
            chrome.extension.sendRequest({action:"update", key:note.key, systemtags:note.systemtags}, function(note) {
                that.note = note;
                $("#" + note.key).removeClass("unread");
            });
        }

        that.$CMbody().one("focus", function() {
            if (!that.note)
                return;

            if (that.note.key)
                that.restoreCaretScroll();
            else if (options.isnewnote)
                that.restoreCaretScroll( {line : "lastline", character: 10000});
        });

        if (options.focus)
            that.focus();

        that.saveTimerInit();

    }, options.duration);

    if (extData.isTab) {
        $("#notes div.noterow").removeClass("selectednote");
        if (note.key && note.key != "") {
            $("#"+ note.key).addClass("selectednote");
            chrome.extension.sendRequest({action:"cm_updatelastopen"});
            snHelpers.scrollSelectedIntoView();
        }
    }
}

//  ---------------------------------------
SNEditor.prototype.saveNote = function(callback) {

    this.saveTimerClear();

    if(!this.isNoteDirty())
        return;

    log("SNEditor.saveNote");

    var key = this.note.key;

    var noteData = {};
    if (this.dirty.content)
        noteData.content = this.codeMirror.getCode();
    if (this.dirty.pinned) {
        snEditor.needCMRefresh("pinned");
        noteData.systemtags = this.note.systemtags;
        if (!this.isPintoggle()) {
            noteData.systemtags.splice(noteData.systemtags.indexOf("pinned"),1);
        } else {
            noteData.systemtags.push("pinned");
        }
    }
    if (this.dirty.markdown) {
        noteData.systemtags = this.note.systemtags;
        if (!this.isMarkdownToggle()) {
            noteData.systemtags.splice(noteData.systemtags.indexOf("markdown"),1);
        } else {
            noteData.systemtags.push("markdown");
        }
    }
    if (this.dirty.tags)
        noteData.tags = this.getTags();
//    if ($('div#note input#encrypted').attr("dirty")=="true")
//        noteData.encrypted = $('div#note input#encrypted')?1:0;

    if (noteData.content == '' && key !='')     // existing note emptied -> trash
        this.trashNote();
    else if (key != '' ) {                  // existing note, new data -> update
        noteData.key = key;
        noteData.action = "update";
    } else if (noteData.content && noteData.content != '')          // new note, new data -> create
        noteData.action = "create";

    var that = this;

    if (noteData.action) {
        chrome.extension.sendRequest(noteData, function(note) {
            if (that.note && (that.note.key == note.key || that.note.key == "")) {
                $("#trash").show();
                that.note = note;
                that.clearDirty();
            }
            if (that.note && that.note.key == "") {

            }
            log("CodeMirror.saveNote: request complete");
            if (callback && typeof callback == "function")
                callback();
        });
    }

}
//  ---------------------------------------
SNEditor.prototype.isNoteDirty = function() {
    return this.dirty.content || this.dirty.pinned || this.dirty.tags || this.dirty.markdown;// || $('div#note input#encrypted').attr("dirty")=="true";
}
//  ---------------------------------------
SNEditor.prototype.clearDirty = function() {
    log("SNEditor.clearDirty");
    this.setDirty("content",false);
    this.setDirty("pinned",false);
    this.setDirty("tags",false);
    this.setDirty("markdown",false);
    //$('div#note input#encrypted').removeAttr('dirty');
}
//  ---------------------------------------
SNEditor.prototype.setDirty = function(what, how, event) {
    if (!what)
        throw new Error("what is dirty?");

    if (how == undefined)
        throw new Error("how dirty is it?");

    if (event == undefined)
        event = {type : "unknown"};

    var oldDirty = this.dirty[what];

    if (oldDirty == how)
        return false;

    this.dirty[what] = how;

    if (how)
        log(what + " dirty now (" + event.type + ")");
    else
        log(what + " not dirty now (" + event.type + ")");

    if (this.isNoteDirty())
        this.showRevert();
    else
        this.hideRevert();

    this.dirtyChangeListener(what);

    return true;
}

SNEditor.prototype.dirtyChangeListener = function(what) {
    var that = this;

    switch(what) {
      case "tags":
        snHelpers.getHeadings(false,function(headings) {
            that.codeMirror.setParser("SimpleParser", {headings: headings, checklist: that.getTags().indexOf("Checklist") >= 0 ? ["-","*"]:false, wikilinks : true});
        })
        break;
    }
}

SNEditor.prototype.needCMRefresh = function(type) {
    switch(type) {
        case "pinned":
            extData.background.SimplenoteBG.needCMRefresh = true;
            break;
        case "lastopen":
            extData.background.SimplenoteBG.needLastOpenRefresh = true;
            break;
        default:
            throw new Error("unknown type " + type);
    }

    if (extData.isTab)
        extData.background.SimplenoteBG.checkRefreshs();
}
SNEditor.prototype.setupTags = function() {
    var that = this;
    log("SNEditor.setupTags:sending request")

    $("#as-selections-tagsauto").remove();
    $("#as-results-tagsauto").remove();
    $("#tags").remove();
    $('#note').prepend('<input type="text" id="tags" spellcheck="false" tabindex="0"/>');
    $('#tags').autoSuggest(function(callback) {
                chrome.extension.sendRequest({action:"tags",options: {sort:"frequency",predef:false}}, function(taginfos) {
                        taginfos = taginfos.map(function(e) {return {value: e.tag};}).filter(function(e) {return extData.builtinTags.indexOf(e.value.toLowerCase()) < 0});
                        log("SNEditor.setupTags:request complete, numtags=" + taginfos.length);
                        taginfos.unshift({value:"Checklist"});
                        callback(taginfos);
                });
            }, {
            asHtmlID: "tagsauto",
            startText: chrome.i18n.getMessage("tag_placeholder"),
            preFill: that.note.tags.join(","),
            selectionAdded: function(elem) {
                if (that.getTags())
                    that.setDirty("tags", !arrayEqual(that.note.tags,that.getTags()));
            },
            selectionRemoved: function(elem) {
                elem.remove();
                if (that.getTags())
                    that.setDirty("tags", !arrayEqual(that.note.tags,that.getTags()));

            },
            onChange: function() {
                $("#cmwrapper").css("top", Math.max($(".as-selections").height() + 4,32) + "px");
                that.saveTimerRearm();
            },
            onSetupDone: function() {

                that.adjustTagsWidth();
                $("#cmwrapper").css("top", Math.max($(".as-selections").height() + 4,32) + "px");
                $("#as-selections-tagsauto").attr("title",chrome.i18n.getMessage("tag_tooltip",["alt-t", "alt-e"]));
                //tooltip("#as-selections-tagsauto");
            },
            keyDelay: 10,
            onTabOut: function() {
                snEditor.focus();
            }
        });
}
//  ---------------------------------------
SNEditor.prototype.trashNote = function() {
    if (!this.note || this.note.key == "")
        return;
    log("SNEditor.trashNote");

    snHelpers.trashNote(this.note.key);
}

SNEditor.prototype.saveTimerInit = function() {
    if (!extData.isTab)
        return;
    var that = this;

    // Allocate timer element
    this.savetimer = {
            timer : null,
            text : that.codeMirror.getCode(),
            wait : extData.editorSaveTime
    };

    this.$CMbody().keydown(function() {that.saveTimerRearm()});

}
SNEditor.prototype.saveTimerClear = function() {
    if (!extData.isTab)
        return;

    if (this.savetimer)
        clearTimeout(this.savetimer.timer);
}
SNEditor.prototype.saveTimerRearm = function() {
    if (!extData.isTab)
        return;
    var that = this;

    clearTimeout(this.savetimer.timer);
    this.savetimer.timer = setTimeout(function() {that._saveTimerExecute();}, this.savetimer.wait);
}

SNEditor.prototype._saveTimerExecute = function() {
    if (!extData.isTab)
        return;

    var elTxt = this.codeMirror.getCode();

    // Fire if text > options.captureLength AND text != saved txt OR if override AND text > options.captureLength
    //if ( elTxt != that.timer.text )  {
            this.savetimer.text = elTxt;
            this.saveNote();
    //}
}

SNEditor.prototype.setPintoggle = function(to) {
    if (to) {
        $('#pintoggle').addClass("pinned");
        $('#pintoggle').removeClass("unpinned");
    } else {
        $('#pintoggle').addClass("unpinned");
        $('#pintoggle').removeClass("pinned");
    }
}

SNEditor.prototype.isPintoggle = function() {
    return $('#pintoggle').hasClass("pinned");
}

SNEditor.prototype.setWraptoggle = function(to) {
    if (to) {
        $('#wraptoggle').addClass("wrap_on");
        $('#wraptoggle').removeClass("wrap_off");
    } else {
        $('#wraptoggle').addClass("wrap_off");
        $('#wraptoggle').removeClass("wrap_on");
    }
}

SNEditor.prototype.isWraptoggle = function() {
    return $('#wraptoggle').hasClass("wrap_on");
}

SNEditor.prototype.setPreviewtoggle = function(to) {
    if (to) {
        $('#previewtoggle').addClass("preview_on");
        $('#previewtoggle').removeClass("preview_off");
    } else {
        $('#previewtoggle').addClass("preview_off");
        $('#previewtoggle').removeClass("preview_on");
    }
    this.setPreviewPane();

    if (to && this.note)
        this.updateMarkdown();
}

SNEditor.prototype.isPreviewtoggle = function() {
    return $('#previewtoggle').hasClass("preview_on");
}

SNEditor.prototype.setPreviewPane = function() {
    if (this.isMarkdownToggle() && this.isPreviewtoggle()) {
        $("#cmiframe").css("width","50%");
        $("#markdownpreview").show();
        $("#markdownpreviewspacer").show();
    } else {
        $("#markdownpreview").hide();
        $("#markdownpreviewspacer").hide();
        $("#cmiframe").css("width","100%");
        $("#cmiframe").show();
    }
}

SNEditor.prototype.isMarkdownToggle = function() {
    return !$('#markdowntoggle').hasClass("off");
}

SNEditor.prototype.setMarkdownToggle = function(to) {

    if (to) {
        $('#previewtoggle').show();
        $('#markdowntoggle').removeClass("off");
        $('#markdowntoggle').addClass("on");
    } else {
        $('#previewtoggle').hide();
        $('#markdowntoggle').removeClass("on");
        $('#markdowntoggle').addClass("off");
    }
    this.adjustTagsWidth();
    this.setPreviewPane();
    if (to && this.note)
        this.updateMarkdown();
}

SNEditor.prototype.updateMarkdown = function(input,nocache) {
    if (!this.isMarkdownToggle() || !this.isPreviewtoggle())
        return;

    var server = "S", local ="L";

    log("rendering markdown");
//    var converter = new Showdown.converter();
//    var html = converter.makeHtml(m);
    //var html = markdown.toHTML(m);
    //var html = Markdown(m);

    if (typeof input == "string") {
        log("updating markup locally");
        var converter = new Showdown.converter();
        this.setMarkdownHtml(converter.makeHtml(input), local, "Syncpad uses a local markdown preview if the note has not yet been saved to the server. It might differ from the server version, and does not support 'Markdown Extra'");
    } else if (!input && (this.note.key == "" || this.dirty.content)){
        var converter = new Showdown.converter();
        this.setMarkdownHtml(converter.makeHtml(snEditor.codeMirror.getCode()), local, "Syncpad uses a local markdown preview if the note has not yet been saved to the server. It might differ from the server version, and does not support 'Markdown Extra'");
    } else {
        var version, key;
        if (!input) {
            log("updating markup from server with stored note version");
            version = this.note.version;
            key = this.note.key;
        } else {
            log("updating markup from server with input note version");
            version = input.version;
            key = input.key;
        }
        var serverTitle = "Markdown output as displayed by the Simplenote server. Updated each time after the note has been uploaded to the server.";

        if (!nocache && snEditor.markupCache && snEditor.markupCache[key] && snEditor.markupCache[key].version == version) {
            log("no, actually from cache");

            this.setMarkdownHtml(snEditor.markupCache[key].html, server, serverTitle)
        } else {
            //$("#markdownpreview").addClass("loading");
            $("#markdowninfo").css("right", (cssprop("#note","right") + 35) + "px")
                            .html("&nbsp;")
                            .addClass("loading");

            $.ajax({
                    url: "https://simple-note.appspot.com/markdown/" + key + "/" + version,
                    timeout: 5000,
                    complete : function(jqXHR, textStatus) {
                        if (textStatus == "success") {
                            if (!snEditor.markupCache)
                                snEditor.markupCache = {};

                            snEditor.markupCache[key] = {
                                version: version,
                                html: JSON.parse(jqXHR.responseText).html
                            }

                            snEditor.setMarkdownHtml(snEditor.markupCache[key].html, server, serverTitle);
                        } else {
                            var converter = new Showdown.converter();
                            snEditor.setMarkdownHtml(converter.makeHtml(snEditor.codeMirror.getCode()), local + " (" + textStatus + ")", "Server error, using local preview.");
                        }
                        //$("#markdownpreview").removeClass("loading");
                        $("#markdowninfo").removeClass("loading");
                    }
            });
        }
    }

}

SNEditor.prototype.clearMarkdown = function() {
    $("#markdownpreview").html("<span id='markdowninfo'></span>");
}

SNEditor.prototype.setMarkdownHtml = function(html, info, moreinfo) {
    $("#markdownpreview").html("<span id='markdowninfo'>" + info + "</span>" + html);
    if (moreinfo) {
        $("#markdowninfo").attr("title",moreinfo);
        //tooltip("#markdownpreview #markdowninfo",{position: "bottom left"});
    }

    $("#markdowninfo").css("right", (cssprop("#note","right") + 35) + "px");
    $("#markdowninfo").click(function(event) {
        snEditor.updateMarkdown(undefined,true);
        event.stopPropagation();
    });

    $('#markdownpreview a').attr('target', '_blank');
    $('#markdownpreview a[href^="#"]').click(function(event) {
        event.preventDefault();
        event.stopPropagation();
        $($(this).attr("href").replace(":","\\:")).get(0).scrollIntoView();
        snEditor.syncScrolls();
    });
    this.syncScrolls("fromeditor");

}

SNEditor.prototype.print = function() {
    this.codeMirror.win.print();
}

SNEditor.prototype.showRevert = function() {
    if (!extData.isTab)
        $('#revert').show();
    this.adjustTagsWidth();
}

SNEditor.prototype.hideRevert = function() {
    $('#revert').hide();
    this.adjustTagsWidth();
}

SNEditor.prototype.adjustTagsWidth = function() {
    if ($("#revert").is(":visible"))
        $("#as-selections-tagsauto").css("right", ($("#note").width() - $("#revert").position().left +10) + "px");
    else
        $("#as-selections-tagsauto").css("right", ($("#note").width() - $("#pintoggle").position().left + 10) + "px");
}

var snHelpers = {

    //  ---------------------------------------
    // from inview.js
    getViewportSize : function () {
        var mode, domObject, size = {
            height: window.innerHeight,
            width: window.innerWidth
        };

        // if this is correct then return it. iPad has compat Mode, so will
        // go into check clientHeight/clientWidth (which has the wrong value).
        if (!size.height) {
            mode = document.compatMode;
            if (mode || !$.support.boxModel) { // IE, Gecko
                domObject = mode === 'CSS1Compat' ?
                document.documentElement : // Standards
                document.body; // Quirks
                size = {
                    height: domObject.clientHeight,
                    width:  domObject.clientWidth
                };
            }
        }

        return size;
    },
    //  ---------------------------------------
    // from inview.js
    getViewportOffset: function() {
        return {
            top:  window.pageYOffset || document.documentElement.scrollTop || document.body.scrollTop,
            left: window.pageXOffset || document.documentElement.scrollLeft || document.body.scrollLeft
        };
    },

    //  ---------------------------------------
    // from inview.js
    checkInView: function() {
        //tick();
        var $inView = snHelpers.getInView("#notes div.nocontent");

        $inView.each(function(i,e) {
            $(e).replaceWith(snIndex.snNotelist.noteRawHTML(snIndex.snNotelist.getNote(e.id), true, true));
            if (localStorage.option_showdate == "true")
                $("#" + e.id + " abbr.notetime").timeago();
        });



        //tock("checkinview");
    },

    //  ---------------------------------------
    // from inview.js
    getInView: function(sel) {
        //tick();
        var elements = $(sel).get(), i = 0, viewportSize, viewportOffset;
        var elementsLength = elements.length;
        var res = [];

        if (elementsLength) {
            viewportSize   = snHelpers.getViewportSize();
            viewportOffset = snHelpers.getViewportOffset();

            //log("checkInView:viewportSize=[" + viewportSize.height + "," + viewportSize.width + "], viewportOffset=[" + viewportOffset.left + "," + viewportOffset.top + "]");
            // fix a bug on first load, size not initialized
            if (viewportSize.height == 0 && viewportSize.width == 0) {
                viewportSize.height = 502;viewportSize.width = 400;
            }

            for (; i<elementsLength; i++) {

                var $element      = $(elements[i]),
                elementSize   = {
                    height: $element.height(),
                    width: $element.width()
                },
                elementOffset = $element.offset(),
                inview        = false;

                //log("checkInView:elementSize=[" + elementSize.height + "," + elementSize.width + "], elementOffset=[" + elementOffset.left + "," + elementOffset.top + "]");

                inview = elementOffset.top <= viewportOffset.top + viewportSize.height*(1 + extData.preLoadFactor) &&
                    elementOffset.left + elementSize.width >= viewportOffset.left &&
                    elementOffset.left <= viewportOffset.left + viewportSize.width;

    //            console.log(i + ": loaded " + loaded + ", inview=" + inview);
    //            console.log(elementOffset);
    //            console.log(elementOffset);

                if (inview) {
                    res.push($element.get(0));
                }
            }
        }
        //tock("checkinview");
        return $(res);
    },

    scrollSelectedIntoView: function() {
        var $noterow = $("#notes div.selectednote");
        if ($noterow.length == 1) {
            var $notes = $noterow.parent("#notes");

            var relativeOffset = $noterow.offset().top - $notes.offset().top + $notes.scrollTop();
            var viewportHeight = $notes.innerHeight() - cssprop($notes,"margin-bottom");

            //log("scrollSelectedIntoView:[" + $notes.scrollTop() + " < "+ relativeOffset + " < " + (relativeOffset + $noterow.height()) + " < " + ($notes.scrollTop() + viewportHeight) + "]");

            var isAbove = relativeOffset < $notes.scrollTop();
            var isBelow = relativeOffset + $noterow.height() > $notes.scrollTop() + viewportHeight;

            if (isAbove || isBelow) {
                var scrollTo = relativeOffset - 0.5*$notes.height() + 0.5*$noterow.height();
                //log("scrollSelectedIntoView:" + scrollTo )
                $notes.scrollTop(scrollTo);
            }
        }

    },

    printTimes: function() {
        for(var i in extData.times)
            log(i + ": " + extData.times[i]);
    },

    getHeadings: function(full, callback) {
        chrome.extension.sendRequest({action:"getnotes", deleted: 0}, function(notes) {
            extData.headings = headings(notes, true);
            callback(headings(notes,full));
        });
    },

    noteRowInIndex: function(key) {
        return $('#' + key).length > 0;
    },

    trashNote: function(key) {
        chrome.extension.sendRequest({action : "update", key : key, deleted: 1},
            function() {
                snEditor.hideIfNotInIndex();
                snHelpers.checkInView();
            });
    },

    untrashNote: function(key) {
        chrome.extension.sendRequest({action : "update", key : key, deleted : 0},
            function() {
                snEditor.hideIfNotInIndex();
                snHelpers.checkInView();
            });
    }
}

$(document).ready(readyListener);

//$(window).load(readyListener);
$(window).resize(snHelpers.checkInView)
addEventListener("unload", unloadListener, true);
$(document).keydown(shortcutListener);

//}
//
//$(document).ready(function() {
//    syncPad(extData, jQuery, localStorage)
//});
