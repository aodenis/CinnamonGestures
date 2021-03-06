// Copyright (C) 2020 Aodenis

// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program.  Ifnot, see <https://www.gnu.org/licenses/>.

#include <dbus/dbus.h>
#include <libudev.h>
#include <libinput.h>

#include <iostream>
#include <cstring>
#include <chrono>
#include <map>
#include <vector>

#include <fcntl.h>
#include <sys/poll.h>
#include <sys/types.h>
#include <sys/stat.h>

#include <unistd.h>

using namespace std;

#define MILLISECONDS_BEFORE_DEATH 20000 //10000
#define POLL_WAIT_TIME 5000

static int open_restricted(const char *path, int flags, void *user_data)
{
	int fd = open(path, flags);
	return fd < 0 ? -errno : fd;
}

static void close_restricted(int fd, void *user_data)
{
	close(fd);
}

const static struct libinput_interface interface = {
	.open_restricted = open_restricted,
	.close_restricted = close_restricted,
};

class GestureServer
{
public:
	GestureServer();
	~GestureServer();
	int run();
	bool isGood() const;
	DBusHandlerResult onMessage(DBusMessage *message);

	dbus_bool_t addWatch(DBusWatch* watch);
	void toggleWatch(DBusWatch* watch);
	void removeWatch(DBusWatch* watch);

private:
	void resetPollfdArray();
	void rebuildPollfdArray();
	void handleDBusInput();
	void handleInput();
	bool handleGestureEvent(libinput_event *event);
	void sendGestureEvent(uint8_t type, int16_t fingerCount, double dx, double dy);

private:
	int exitCode;
	map<DBusWatch*,pollfd> watches;

    DBusMessage* msg;
    DBusConnection* conn;
    DBusError err;
    chrono::system_clock::time_point lastKA;
    libinput* li;
    bool goodbit;
    bool fullRebuildNeeded;
    pollfd libinputPollfd;
    bool skipNextStartInSession;
    int16_t fingerCountForLatentStop;
    vector<pollfd> pollfdArray;
	vector<DBusWatch*> watchArray;
};

dbus_bool_t _add(DBusWatch* w, void* d)
{
	return ((GestureServer*)d)->addWatch(w);
}

void _toggle(DBusWatch* w, void* d)
{
	return ((GestureServer*)d)->toggleWatch(w);
}

void _remove(DBusWatch* w, void* d)
{
	((GestureServer*)d)->removeWatch(w);
}

DBusHandlerResult _message_function(DBusConnection *connection, DBusMessage *message, void *d)
{
	return ((GestureServer*)d)->onMessage(message);
}

const DBusObjectPathVTable gs_vtable
{
	.unregister_function = nullptr,
	.message_function = _message_function
};

const char* descriptor = "<!DOCTYPE node PUBLIC \"-//freedesktop//DTD D-BUS Object Introspection 1.0//EN\" \
\"http://www.freedesktop.org/standards/dbus/1.0/introspect.dtd\"> \
<node> \
	<interface name=\"org.freedesktop.DBus.Introspectable\"> \
		<method name=\"Introspect\"> \
			<arg name=\"data\" direction=\"out\" type=\"s\"/> \
		</method> \
	</interface> \
	<interface name=\"org.aodenis.gestured\"> \
		<method name=\"StayAlive\"> \
		</method> \
		<signal name=\"UpdateGesture\"> \
			<arg direction=\"out\" type=\"y\"/> \
			<arg direction=\"out\" type=\"n\"/> \
			<arg direction=\"out\" type=\"d\"/> \
			<arg direction=\"out\" type=\"d\"/> \
		</signal> \
	</interface> \
</node>";

DBusHandlerResult GestureServer::onMessage(DBusMessage* msg)
{
	if(dbus_message_is_method_call(msg, "org.aodenis.gestured", "StayAlive")) {
     	lastKA = chrono::system_clock::now();
		DBusMessage* msg2 = dbus_message_new_method_return(msg);
		if(msg2 == nullptr)
		{
			cerr << "[!] Out of memory" << endl;
			exitCode = 2;
			return DBUS_HANDLER_RESULT_HANDLED;
		}
		dbus_connection_send(conn, msg2, nullptr);
		dbus_message_unref(msg2);
     	// cout << "[*] Keep Alive message received..." << endl;
		return DBUS_HANDLER_RESULT_HANDLED;

  	} else if(dbus_message_is_method_call(msg, "org.freedesktop.DBus.Introspectable", "Introspect")) {
		DBusMessage* msg2 = dbus_message_new_method_return(msg);
		if(msg2 == nullptr)
		{
			cerr << "[!] Out of memory" << endl;
			exitCode = 2;
			return DBUS_HANDLER_RESULT_HANDLED;
		}
		DBusMessageIter args;
		dbus_message_iter_init_append(msg2, &args);
		if(!dbus_message_append_args (msg2,
	                          DBUS_TYPE_STRING, &descriptor,
	                          DBUS_TYPE_INVALID))
		{
			cerr << "[!] Message creation failed" << endl;
			exitCode = 2;
			return DBUS_HANDLER_RESULT_HANDLED;
		}
		dbus_connection_send(conn, msg2, nullptr);
		dbus_message_unref(msg2);
     	// cout << "[*] Introspection message received..." << endl;
		return DBUS_HANDLER_RESULT_HANDLED;
  	}
    else cout << "[?] Unknown message : interface " << dbus_message_get_interface(msg) << " method/signal : " << dbus_message_get_interface(msg) << endl;
    return DBUS_HANDLER_RESULT_NOT_YET_HANDLED;
}

GestureServer::GestureServer() : exitCode(-1), watches(), msg(nullptr), conn(nullptr), li(nullptr), goodbit(false), fullRebuildNeeded(true)
{
	goodbit = false;
	dbus_error_init(&err);
    conn = dbus_bus_get(DBUS_BUS_SYSTEM, &err);
    if(dbus_error_is_set(&err)) {
        cerr << "[!] Connection error " << err.message << endl;
        conn = nullptr;
        return;
    }

    if(conn == nullptr) {
        cerr << "[!] Unknown connection error" << endl;
        return;
    }

	if(!dbus_connection_set_watch_functions(conn, _add, _remove, _toggle, this, nullptr)) {
		cerr << "[!] Unable to set watch function" << endl;
		return;
	}

	dbus_bus_add_match(conn,
         "type='method',interface='org.aodenis.gestured'",
         nullptr);
	dbus_bus_add_match(conn,
         "type='method',interface='org.freedesktop.DBus.Introspectable'",
         nullptr);

	dbus_connection_try_register_object_path(conn, "/", &gs_vtable, this, &err);
	if(dbus_error_is_set(&err)) {
        cerr << "Error registering object " << err.message << endl;
        return;
    }

	/*dbus_connection_try_register_fallback(conn, "/", &gs_vtable, this, &err);
	if(dbus_error_is_set(&err)) {
        cerr << "Error registering fallback object " << err.message << endl;
        return;
    }*/

    dbus_bus_request_name(conn, "org.aodenis.gestured", DBUS_NAME_FLAG_REPLACE_EXISTING, &err);
    if(dbus_error_is_set(&err)) {
        cerr << "Name Error " << err.message << endl;
        return;
    }

	struct udev* udev_context = udev_new();

	if(udev_context == nullptr)
	{
		cerr << "[!] Failed to create udev context" << endl;
		return;
	}

	if((li = libinput_udev_create_context(&interface, nullptr, udev_context)) == nullptr)
	{
		cerr << "[!] Failed to create libinput context" << endl;
		udev_unref(udev_context);
		return;
	}

	if(libinput_udev_assign_seat(li, "seat0") == -1)
	{
		cerr << "[!] Failed to assign seat to libinput context" << endl;
		libinput_unref(li);
		udev_unref(udev_context);
		return;
	}

	udev_unref(udev_context);
	libinputPollfd.events = POLLHUP | POLLERR | POLLIN | POLLOUT;
	libinputPollfd.revents = 0;
	libinputPollfd.fd = libinput_get_fd(li);

	goodbit = true;
}

bool GestureServer::isGood() const
{
	return goodbit;
}

GestureServer::~GestureServer()
{
	pollfdArray.clear();
	watchArray.clear();
	if(conn)dbus_connection_unref(conn);
	conn = nullptr;
	if(li)libinput_unref(li);
	li = nullptr;
	dbus_error_free(&err);
}

dbus_bool_t GestureServer::addWatch(DBusWatch *watch)
{
	short cond = POLLHUP | POLLERR;
	int fd = dbus_watch_get_unix_fd(watch);
	unsigned int flags = dbus_watch_get_flags(watch);

	if(flags & DBUS_WATCH_READABLE) cond |= POLLIN;
	if(flags & DBUS_WATCH_WRITABLE) cond |= POLLOUT;

	pollfd npfd = {
		.fd = fd,
		.events = cond
	};
	watches[watch] = npfd;
	fullRebuildNeeded = true;
	return 1;
}

void GestureServer::toggleWatch(DBusWatch *watch)
{
	fullRebuildNeeded = true;
}

void GestureServer::removeWatch(DBusWatch *watch)
{
	if(watches.erase(watch))
	{
		fullRebuildNeeded = true;
		rebuildPollfdArray();
	}
}

void GestureServer::rebuildPollfdArray()
{
	if(fullRebuildNeeded)
	{
		pollfdArray.clear();
		watchArray.clear();
		pollfdArray.push_back(libinputPollfd);
		watchArray.push_back(nullptr);
		for(auto& [watch, pfd] : watches)
		{
			if(dbus_watch_get_enabled(watch))
			{
				watchArray.push_back(watch);
				pollfdArray.push_back(pfd);
			}
		}
		fullRebuildNeeded = false;
	}
	resetPollfdArray();
}

void GestureServer::resetPollfdArray()
{
	for(unsigned int i = 0; i < pollfdArray.size(); i++)
		pollfdArray.at(i).revents = 0;
}

int main()
{
	if(getuid() != 0)
	{
		cout << "[!] Must be run as root" << endl;
		return 1;
	}

	GestureServer app;
	if(!app.isGood())return 1;
	return app.run();
}

void GestureServer::handleDBusInput()
{
	while (dbus_connection_dispatch(conn) == DBUS_DISPATCH_DATA_REMAINS);
	// while (dbus_connection_read_write_dispatch (conn, 0));
}

void GestureServer::sendGestureEvent(uint8_t type, int16_t fingerCount, double dx, double dy)
{

	DBusMessage* msg;
	DBusMessageIter args;

	msg = dbus_message_new_signal("/", "org.aodenis.gestured", "UpdateGesture");
	if(msg == nullptr) {
		cerr << "[!] Message creation failed" << endl;
		exitCode = 5;
		return;
	}

	// append arguments
	dbus_message_iter_init_append(msg, &args);
	if(!dbus_message_append_args (msg,
                          DBUS_TYPE_BYTE, &type,
                          DBUS_TYPE_INT16, &fingerCount,
                          DBUS_TYPE_DOUBLE, &dx,
                          DBUS_TYPE_DOUBLE, &dy,
                          DBUS_TYPE_INVALID)) {
		cerr << "[!] Message creation failed" << endl;
		exitCode = 5;
		dbus_message_unref(msg);
		return;
	}

	if(!dbus_connection_send (conn, msg, nullptr)) {
		cerr << "[!] Message send failed" << endl;
		exitCode = 5;
	}

	dbus_message_unref(msg);
}

bool GestureServer::handleGestureEvent(libinput_event *event)
{
	libinput_event_gesture* gesture_event = libinput_event_get_gesture_event(event);
	uint8_t type = 255;
	bool isPinch = false;
	switch(libinput_event_get_type(event))
	{
		case LIBINPUT_EVENT_GESTURE_SWIPE_BEGIN:
		case LIBINPUT_EVENT_GESTURE_SWIPE_END:
		case LIBINPUT_EVENT_GESTURE_SWIPE_UPDATE:
			isPinch = false;
			break;
		case LIBINPUT_EVENT_GESTURE_PINCH_BEGIN:
		case LIBINPUT_EVENT_GESTURE_PINCH_END:
		case LIBINPUT_EVENT_GESTURE_PINCH_UPDATE:
			isPinch = true;
			break;
		default:
			break;
	}
	switch(libinput_event_get_type(event))
	{
		case LIBINPUT_EVENT_GESTURE_SWIPE_BEGIN:
		case LIBINPUT_EVENT_GESTURE_PINCH_BEGIN:
			if(skipNextStartInSession)
			{
				skipNextStartInSession = false;
				return true;
			}
			type = 0;
			break;
		case LIBINPUT_EVENT_GESTURE_SWIPE_END:
		case LIBINPUT_EVENT_GESTURE_PINCH_END:
			if(libinput_event_gesture_get_cancelled(gesture_event) == true)
			{
				skipNextStartInSession = true;
				fingerCountForLatentStop = libinput_event_gesture_get_finger_count(gesture_event);
				return true;
			}
			type = 1;
			break;
		case LIBINPUT_EVENT_GESTURE_SWIPE_UPDATE:
		case LIBINPUT_EVENT_GESTURE_PINCH_UPDATE:
			type = 2;
			break;
		default:
			break;
	}
	skipNextStartInSession = false;
	uint16_t fingerCount = libinput_event_gesture_get_finger_count(gesture_event);
	double x;
	double y;
	if(isPinch)
	{
		type += 3;
		x = libinput_event_gesture_get_scale(gesture_event);
		y = libinput_event_gesture_get_angle_delta(gesture_event);
	}
	else
	{
		x = libinput_event_gesture_get_dx(gesture_event);
		y = libinput_event_gesture_get_dy(gesture_event);
	}
	libinput_event_destroy(event);
	sendGestureEvent(type, fingerCount, x, y);
	return true;
}

void GestureServer::handleInput()
{
	skipNextStartInSession = false;
	libinput_event* event = nullptr;
	libinput_dispatch(li);
	while ((event = libinput_get_event(li)) != nullptr) {
        auto li_ev = libinput_event_get_type(event);
		switch(li_ev)
		{
			case LIBINPUT_EVENT_GESTURE_SWIPE_BEGIN:
			case LIBINPUT_EVENT_GESTURE_SWIPE_END:
			case LIBINPUT_EVENT_GESTURE_SWIPE_UPDATE:
			// case LIBINPUT_EVENT_GESTURE_PINCH_BEGIN:
			// case LIBINPUT_EVENT_GESTURE_PINCH_END:
			// case LIBINPUT_EVENT_GESTURE_PINCH_UPDATE:
				// cout << "[*] Gesture event" << endl;
				handleGestureEvent(event);
				if(skipNextStartInSession)sendGestureEvent(1, fingerCountForLatentStop, 0, 0);
				break;
			default:
        		libinput_event_destroy(event);
				break;
		}
	}
}

int GestureServer::run()
{
	lastKA = chrono::system_clock::now();
	pollfd* _pollfdArray = nullptr; 
	unsigned int pollfdArraySize = 0;
	int32_t pollret = 0;
	uint32_t loop = 0;
	while (true) {
		if(fullRebuildNeeded)
		{
			rebuildPollfdArray();
			_pollfdArray = &(pollfdArray[0]);
			pollfdArraySize = pollfdArray.size();
		}

		pollret = poll(_pollfdArray, pollfdArraySize, POLL_WAIT_TIME);
		if(pollret < 0)
		{
			if(errno == EINTR) continue;
			cerr << "[?] Error while polling " << strerror(errno) << endl;
			exitCode = 1;
			break;
		}

		if(pollret and _pollfdArray->revents)
		{
			handleInput();
			_pollfdArray->revents = 0;
			pollret--;
		}

		if(pollret)
		{
			bool dbusEvent = false;
			for(unsigned int i = 1; i < pollfdArraySize; i++)
			{
				if(_pollfdArray[i].revents)
				{
					decltype(pollfd::revents) events = _pollfdArray[i].revents;
					unsigned int flags = 0;
	        		if(events & POLLIN)flags |= DBUS_WATCH_READABLE;
	        		if(events & POLLOUT)flags |= DBUS_WATCH_WRITABLE;
	        		if(events & POLLHUP)flags |= DBUS_WATCH_HANGUP;
	        		if(events & POLLERR)flags |= DBUS_WATCH_ERROR;
	        		_pollfdArray[i].revents = 0;
					if(dbus_watch_handle(watchArray[i], flags) == FALSE)
					{
						cout << "out of memory" << endl;
					}
					dbusEvent = true;
					if((--pollret) == 0)break;
				}
			}
			if(dbusEvent)
				handleDBusInput();
		}

		if(exitCode != -1)
			break;
		if(++loop == 1000)
		{
			if(chrono::duration_cast<chrono::milliseconds>(chrono::system_clock::now()-lastKA).count() >= MILLISECONDS_BEFORE_DEATH)
			{
				cout << "[*] No listener, quitting" << endl;
				exitCode = 0;
				break;
			}
			loop = 0;
		}
	}
	return exitCode;
}
