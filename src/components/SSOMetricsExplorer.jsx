import React, { useState, useCallback, useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

const SSOMetricsExplorer = () => {
    // State for file input and data
    const [isLoading, setIsLoading] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const [parsedData, setParsedData] = useState([]);
    const [activeUsers, setActiveUsers] = useState(0);
    const [applications, setApplications] = useState({});
    const [userApplications, setUserApplications] = useState([]);
    const [appUsers, setAppUsers] = useState({});
    const [dateRange, setDateRange] = useState({ min: '', max: '' });
    const [activeTab, setActiveTab] = useState('summary');
    const [filterStartDate, setFilterStartDate] = useState('');
    const [filterEndDate, setFilterEndDate] = useState('');
    const [selectedApp, setSelectedApp] = useState('all');
    const [searchUsername, setSearchUsername] = useState('');
    const [error, setError] = useState('');
    const [progress, setProgress] = useState(0);

    // Handle file input
    const handleFileUpload = async (event) => {
        const file = event.target.files[0];
        if (!file) return;

        setIsLoading(true);
        setError('');

        try {
            const reader = new FileReader();

            reader.onprogress = (event) => {
                if (event.lengthComputable) {
                    const percentLoaded = Math.round((event.loaded / event.total) * 100);
                    setProgress(percentLoaded);
                }
            };

            reader.onload = async (e) => {
                try {
                    setIsProcessing(true);
                    const text = e.target.result;

                    // Process the data in chunks to avoid UI freezing
                    await processLargeFile(text);

                    setIsLoading(false);
                    setIsProcessing(false);
                } catch (err) {
                    setError(`Error processing data: ${err.message}`);
                    setIsLoading(false);
                    setIsProcessing(false);
                }
            };

            reader.onerror = () => {
                setError('Error reading file');
                setIsLoading(false);
            };

            reader.readAsText(file);
        } catch (err) {
            setError(`Error: ${err.message}`);
            setIsLoading(false);
        }
    };

    // Process large file in chunks using web workers if available
    const processLargeFile = async (fileContent) => {
        // Check if data is JSON array or JSONL
        let lines;
        try {
            // First try parsing as JSON array
            const parsedJson = JSON.parse(fileContent);
            if (Array.isArray(parsedJson)) {
                await processDataChunks(parsedJson);
                return;
            }
        } catch (e) {
            // Not a JSON array, try JSONL format
            lines = fileContent.split('\n').filter(line => line.trim());
        }

        // Process JSONL
        if (lines && lines.length > 0) {
            const chunkSize = 10000; // Process 10,000 lines at a time
            const totalChunks = Math.ceil(lines.length / chunkSize);

            let processedData = [];

            for (let i = 0; i < totalChunks; i++) {
                const chunk = lines.slice(i * chunkSize, (i + 1) * chunkSize);
                const chunkData = chunk.map(line => {
                    try {
                        return JSON.parse(line);
                    } catch (e) {
                        return null;
                    }
                }).filter(item => item !== null);

                processedData = [...processedData, ...chunkData];

                // Update progress
                setProgress(Math.round(((i + 1) / totalChunks) * 100));

                // Let the UI update
                await new Promise(resolve => setTimeout(resolve, 0));
            }

            await processDataChunks(processedData);
        }
    };

    // Process data in chunks to avoid UI freezing
    const processDataChunks = async (dataArray) => {
        const chunkSize = 10000;
        const totalChunks = Math.ceil(dataArray.length / chunkSize);

        // Initialize aggregators
        const userSet = new Set();
        const appCounts = {};
        const appUsersMap = {};
        const userAppsMap = {};
        const dates = [];

        // Process in chunks
        for (let i = 0; i < totalChunks; i++) {
            const chunk = dataArray.slice(i * chunkSize, (i + 1) * chunkSize);

            chunk.forEach(entry => {
                // Only count successful authentications
                if (entry.sso_token_success === true) {
                    // Extract user info
                    const userId = entry.initiated_by?.id;
                    const username = entry.initiated_by?.username;

                    if (userId) {
                        userSet.add(userId);

                        // Track which applications each user accesses
                        if (!userAppsMap[userId]) {
                            userAppsMap[userId] = {
                                username: username,
                                apps: new Set(),
                                lastSeen: entry.timestamp,
                                events: [] // Track all events for this user
                            };
                        } else if (entry.timestamp && new Date(entry.timestamp) > new Date(userAppsMap[userId].lastSeen)) {
                            userAppsMap[userId].lastSeen = entry.timestamp;
                        }

                        // Store this event with the user
                        if (entry.timestamp && entry.application?.name) {
                            userAppsMap[userId].events.push({
                                timestamp: entry.timestamp,
                                appName: entry.application.name,
                                appDisplayLabel: entry.application.display_label || entry.application.name
                            });

                            userAppsMap[userId].apps.add(entry.application.name);

                            // Count application usage
                            const appName = entry.application.display_label || entry.application.name;
                            appCounts[appName] = (appCounts[appName] || 0) + 1;

                            // Track users per application
                            if (!appUsersMap[appName]) {
                                appUsersMap[appName] = new Set();
                            }
                            appUsersMap[appName].add(userId);
                        }
                    }

                    // Extract date for time-based analysis
                    if (entry.timestamp) {
                        const date = new Date(entry.timestamp);
                        dates.push(date);
                    }
                }
            });

            // Update progress
            setProgress(Math.round(((i + 1) / totalChunks) * 100));

            // Let the UI update
            await new Promise(resolve => setTimeout(resolve, 0));
        }

        // Process user applications data
        const processedUserApps = Object.keys(userAppsMap).map(userId => ({
            userId,
            username: userAppsMap[userId].username,
            appCount: userAppsMap[userId].apps.size,
            apps: Array.from(userAppsMap[userId].apps),
            lastSeen: userAppsMap[userId].lastSeen,
            events: userAppsMap[userId].events
        }));

        // Process app users data
        const processedAppUsers = {};
        Object.keys(appUsersMap).forEach(appName => {
            processedAppUsers[appName] = {
                count: appUsersMap[appName].size,
                users: Array.from(appUsersMap[appName])
            };
        });

        // Set date range with proper validation
        if (dates.length > 0) {
            // Find min and max dates
            let minDate = new Date(Math.min(...dates));
            let maxDate = new Date(Math.max(...dates));

            // Format dates for input fields (YYYY-MM-DD)
            const minDateStr = minDate.toISOString().split('T')[0];
            const maxDateStr = maxDate.toISOString().split('T')[0];

            setDateRange({
                min: minDateStr,
                max: maxDateStr
            });

            // Set default filter dates
            setFilterStartDate(minDateStr);
            setFilterEndDate(maxDateStr);

            console.log("Date range set:", { min: minDateStr, max: maxDateStr });
        }

        // Update state with processed data
        setParsedData(dataArray);
        setActiveUsers(userSet.size);
        setApplications(appCounts);
        setUserApplications(processedUserApps);
        setAppUsers(processedAppUsers);
    };

    // Handle date filter changes with validation
    const handleStartDateChange = (e) => {
        const newDate = e.target.value;
        setFilterStartDate(newDate);
        console.log("Start date changed to:", newDate);
    };

    const handleEndDateChange = (e) => {
        const newDate = e.target.value;
        setFilterEndDate(newDate);
        console.log("End date changed to:", newDate);
    };

    // Helper function to check if a date is within range
    const isDateInRange = (dateStr) => {
        if (!filterStartDate || !filterEndDate || !dateStr) return true;

        const date = new Date(dateStr);
        const startDate = new Date(filterStartDate);
        const endDate = new Date(filterEndDate);
        endDate.setHours(23, 59, 59, 999); // End of day

        return date >= startDate && date <= endDate;
    };

    // Filter user data based on date range and app selection
    const filteredUserData = useMemo(() => {
        if (!userApplications.length) return [];

        return userApplications
            .filter(user => {
                // Filter users who have at least one event within the date range
                if (filterStartDate && filterEndDate) {
                    const hasEventsInRange = user.events.some(event =>
                        isDateInRange(event.timestamp)
                    );

                    if (!hasEventsInRange) return false;
                }

                // App filter
                if (selectedApp !== 'all') {
                    // Check if user has used the selected app within the date range
                    const hasUsedSelectedApp = user.events.some(event =>
                        (event.appName === selectedApp || event.appDisplayLabel === selectedApp) &&
                        isDateInRange(event.timestamp)
                    );

                    if (!hasUsedSelectedApp) return false;
                }

                // Username search
                if (searchUsername && !user.username.toLowerCase().includes(searchUsername.toLowerCase())) {
                    return false;
                }

                return true;
            })
            .map(user => {
                // Filter the apps to only those used within the date range
                const appsInRange = user.events
                    .filter(event => isDateInRange(event.timestamp))
                    .map(event => event.appName);

                // Get unique apps in range
                const uniqueAppsInRange = [...new Set(appsInRange)];

                return {
                    ...user,
                    appsInRange: uniqueAppsInRange,
                    appCountInRange: uniqueAppsInRange.length
                };
            });
    }, [userApplications, filterStartDate, filterEndDate, selectedApp, searchUsername]);

    // Calculate app usage within the selected date range
    const filteredAppData = useMemo(() => {
        if (!parsedData.length) return [];

        // Create a map to hold app statistics within the date range
        const appStats = {};

        // Go through all user events
        userApplications.forEach(user => {
            user.events.forEach(event => {
                // Skip if outside date range
                if (!isDateInRange(event.timestamp)) return;

                // Skip if not matching selected app (when a specific app is selected)
                if (selectedApp !== 'all' && event.appName !== selectedApp) return;

                const appName = event.appDisplayLabel;

                if (!appStats[appName]) {
                    appStats[appName] = {
                        name: appName,
                        userCount: 0,
                        sessionCount: 0,
                        uniqueUsers: new Set()
                    };
                }

                appStats[appName].uniqueUsers.add(user.userId);
                appStats[appName].sessionCount++;
            });
        });

        // Convert to array format
        return Object.values(appStats)
            .map(app => ({
                name: app.name,
                userCount: app.uniqueUsers.size,
                sessionCount: app.sessionCount
            }))
            .sort((a, b) => b.userCount - a.userCount);
    }, [parsedData, userApplications, filterStartDate, filterEndDate, selectedApp]);

    // Chart data for app usage
    const chartData = useMemo(() => {
        return filteredAppData.slice(0, 10).map(app => ({
            name: app.name,
            userCount: app.userCount,
            sessionCount: app.sessionCount
        }));
    }, [filteredAppData]);

    // Get unique apps for dropdown
    const uniqueApps = useMemo(() => {
        return Object.keys(applications).sort();
    }, [applications]);

    // Calculate total filtered users
    const filteredUserCount = useMemo(() => {
        return filteredUserData.length;
    }, [filteredUserData]);

    // Reset filters handler
    const resetFilters = useCallback(() => {
        setFilterStartDate(dateRange.min);
        setFilterEndDate(dateRange.max);
        setSelectedApp('all');
        setSearchUsername('');
        console.log("Filters reset to:", { start: dateRange.min, end: dateRange.max });
    }, [dateRange]);

    return (
        <div className="flex flex-col p-4 w-full max-w-6xl mx-auto bg-gray-50 rounded-lg shadow">
            <h1 className="text-2xl font-bold mb-4">JumpCloud SSO Metrics Explorer</h1>

            {!parsedData.length && (
                <div className="mb-4">
                    <div className="flex items-center space-x-2 mb-4">
                        <label className="flex items-center px-4 py-2 bg-blue-600 text-white rounded cursor-pointer hover:bg-blue-700">
                            <span>Upload JSON File</span>
                            <input
                                type="file"
                                accept=".json,.jsonl"
                                onChange={handleFileUpload}
                                className="hidden"
                            />
                        </label>
                        <span className="text-gray-600 text-sm">
              (Supports JSON array or JSONL format)
            </span>
                    </div>

                    {(isLoading || isProcessing) && (
                        <div className="mb-4">
                            <div className="w-full bg-gray-200 rounded-full h-4">
                                <div
                                    className="bg-blue-600 h-4 rounded-full transition-all duration-300"
                                    style={{ width: `${progress}%` }}
                                ></div>
                            </div>
                            <p className="text-sm text-gray-600 mt-1">
                                {isLoading ? 'Loading file...' : 'Processing data...'} ({progress}%)
                            </p>
                        </div>
                    )}

                    {error && <div className="mt-2 text-red-600">{error}</div>}
                </div>
            )}

            {parsedData.length > 0 && (
                <>
                    <div className="bg-blue-50 p-4 rounded-lg border border-blue-100 mb-4">
                        <div className="flex flex-wrap justify-between items-center">
                            <div className="flex space-x-4">
                                <div>
                                    <div className="text-sm text-blue-600 font-semibold">Total Records</div>
                                    <div className="text-2xl font-bold">{parsedData.length.toLocaleString()}</div>
                                </div>
                                <div>
                                    <div className="text-sm text-blue-600 font-semibold">Total Users</div>
                                    <div className="text-2xl font-bold">{activeUsers.toLocaleString()}</div>
                                </div>
                                <div>
                                    <div className="text-sm text-blue-600 font-semibold">Total Apps</div>
                                    <div className="text-2xl font-bold">{Object.keys(applications).length}</div>
                                </div>
                            </div>
                            <div>
                                <div className="text-sm text-blue-600 font-semibold">Full Date Range</div>
                                <div className="text-sm font-medium">
                                    {dateRange.min} to {dateRange.max}
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="mb-4 p-4 bg-white rounded-lg border border-gray-200">
                        <h3 className="text-lg font-semibold mb-2">Filter Data</h3>
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
                                <input
                                    type="date"
                                    value={filterStartDate}
                                    onChange={handleStartDateChange}
                                    className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">End Date</label>
                                <input
                                    type="date"
                                    value={filterEndDate}
                                    onChange={handleEndDateChange}
                                    className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Application</label>
                                <select
                                    value={selectedApp}
                                    onChange={(e) => setSelectedApp(e.target.value)}
                                    className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                                >
                                    <option value="all">All Applications</option>
                                    {uniqueApps.map(app => (
                                        <option key={app} value={app}>{app}</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Username Search</label>
                                <div className="relative">
                                    <input
                                        type="text"
                                        value={searchUsername}
                                        onChange={(e) => setSearchUsername(e.target.value)}
                                        placeholder="Search by username"
                                        className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                                    />
                                    {searchUsername && (
                                        <button
                                            onClick={() => setSearchUsername('')}
                                            className="absolute right-2 top-2 text-gray-400 hover:text-gray-600"
                                        >
                                            ✕
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>
                        <div className="mt-4 flex justify-between">
                            <div className="text-sm text-gray-600">
                                Current filter: {filterStartDate || 'No start date'} to {filterEndDate || 'No end date'}
                                {selectedApp !== 'all' ? ` | App: ${selectedApp}` : ''}
                                {searchUsername ? ` | Search: ${searchUsername}` : ''}
                            </div>
                            <button
                                onClick={resetFilters}
                                className="px-4 py-2 bg-gray-200 text-gray-800 rounded hover:bg-gray-300 transition-colors"
                            >
                                Reset Filters
                            </button>
                        </div>
                    </div>

                    <div className="border rounded-lg overflow-hidden">
                        <div className="bg-gray-100 border-b">
                            <div className="flex">
                                <button
                                    className={`px-4 py-2 ${activeTab === 'summary' ? 'bg-white border-b-2 border-blue-600' : ''}`}
                                    onClick={() => setActiveTab('summary')}
                                >
                                    Summary
                                </button>
                                <button
                                    className={`px-4 py-2 ${activeTab === 'users' ? 'bg-white border-b-2 border-blue-600' : ''}`}
                                    onClick={() => setActiveTab('users')}
                                >
                                    Users by App
                                </button>
                                <button
                                    className={`px-4 py-2 ${activeTab === 'apps' ? 'bg-white border-b-2 border-blue-600' : ''}`}
                                    onClick={() => setActiveTab('apps')}
                                >
                                    Apps by User
                                </button>
                            </div>
                        </div>

                        <div className="p-4 bg-white">
                            {activeTab === 'summary' && (
                                <div>
                                    <div className="mb-6">
                                        <h3 className="text-lg font-semibold mb-2">Top Applications by Unique Users</h3>
                                        <div className="h-64">
                                            <ResponsiveContainer width="100%" height="100%">
                                                <BarChart data={chartData}>
                                                    <CartesianGrid strokeDasharray="3 3" />
                                                    <XAxis dataKey="name" />
                                                    <YAxis />
                                                    <Tooltip />
                                                    <Legend />
                                                    <Bar dataKey="userCount" fill="#4f46e5" name="Unique Users" />
                                                    <Bar dataKey="sessionCount" fill="#60a5fa" name="Total Sessions" />
                                                </BarChart>
                                            </ResponsiveContainer>
                                        </div>
                                        <div className="text-sm text-gray-500 mt-2">
                                            Showing data for period: {filterStartDate} to {filterEndDate}
                                            {selectedApp !== 'all' ? ` | App: ${selectedApp}` : ''}
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div>
                                            <h3 className="text-lg font-semibold mb-2">Top 5 Most Used Applications</h3>
                                            <div className="overflow-hidden border rounded-lg">
                                                <table className="min-w-full divide-y divide-gray-200">
                                                    <thead className="bg-gray-50">
                                                    <tr>
                                                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Application</th>
                                                        <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Users</th>
                                                        <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Sessions</th>
                                                    </tr>
                                                    </thead>
                                                    <tbody className="bg-white divide-y divide-gray-200">
                                                    {filteredAppData.slice(0, 5).map((app, index) => (
                                                        <tr key={index}>
                                                            <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{app.name}</td>
                                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 text-right">{app.userCount.toLocaleString()}</td>
                                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 text-right">{app.sessionCount.toLocaleString()}</td>
                                                        </tr>
                                                    ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        </div>

                                        <div>
                                            <h3 className="text-lg font-semibold mb-2">Active Users Summary</h3>
                                            <div className="bg-white p-4 rounded-lg border border-gray-200">
                                                <div className="flex justify-between items-center mb-2">
                                                    <span className="text-sm font-medium text-gray-700">Total Users</span>
                                                    <span className="text-sm font-semibold">{activeUsers.toLocaleString()}</span>
                                                </div>
                                                <div className="flex justify-between items-center mb-2">
                                                    <span className="text-sm font-medium text-gray-700">Filtered Active Users</span>
                                                    <span className="text-sm font-semibold">{filteredUserCount.toLocaleString()}</span>
                                                </div>
                                                <div className="flex justify-between items-center mb-2">
                                                    <span className="text-sm font-medium text-gray-700">User Retention Rate</span>
                                                    <span className="text-sm font-semibold">
                            {activeUsers > 0 ? `${((filteredUserCount / activeUsers) * 100).toFixed(1)}%` : 'N/A'}
                          </span>
                                                </div>
                                                <div className="mt-4">
                                                    <div className="w-full bg-gray-200 rounded-full h-2.5">
                                                        <div
                                                            className="bg-blue-600 h-2.5 rounded-full"
                                                            style={{ width: `${activeUsers > 0 ? (filteredUserCount / activeUsers) * 100 : 0}%` }}
                                                        ></div>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {activeTab === 'users' && (
                                <div>
                                    <h3 className="text-lg font-semibold mb-2">
                                        Users by Application ({filteredUserCount.toLocaleString()} users)
                                        {selectedApp !== 'all' ? ` using ${selectedApp}` : ''}
                                    </h3>
                                    <div className="overflow-x-auto">
                                        <table className="min-w-full border-collapse">
                                            <thead>
                                            <tr className="bg-gray-100">
                                                <th className="p-2 text-left border">Username</th>
                                                <th className="p-2 text-left border">User ID</th>
                                                <th className="p-2 text-left border">Apps Used</th>
                                                <th className="p-2 text-left border">Last Active</th>
                                                <th className="p-2 text-left border">Applications</th>
                                            </tr>
                                            </thead>
                                            <tbody>
                                            {filteredUserData.length > 0 ? (
                                                filteredUserData.map((user, index) => (
                                                    <tr key={index} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                                                        <td className="p-2 border">{user.username}</td>
                                                        <td className="p-2 border font-mono text-xs">{user.userId}</td>
                                                        <td className="p-2 border text-center">{user.appCountInRange || user.appCount}</td>
                                                        <td className="p-2 border">
                                                            {user.lastSeen ? new Date(user.lastSeen).toLocaleString() : 'N/A'}
                                                        </td>
                                                        <td className="p-2 border">
                                                            <div className="flex flex-wrap gap-1">
                                                                {(user.appsInRange || user.apps).map((app, i) => (
                                                                    <span key={i} className={`text-xs px-2 py-1 rounded ${selectedApp !== 'all' && (app === selectedApp || app.includes(selectedApp)) ? 'bg-blue-200 text-blue-800 font-bold' : 'bg-blue-100 text-blue-800'}`}>
                                      {app}
                                    </span>
                                                                ))}
                                                            </div>
                                                        </td>
                                                    </tr>
                                                ))
                                            ) : (
                                                <tr>
                                                    <td colSpan="5" className="p-4 text-center text-gray-500">No matching users found</td>
                                                </tr>
                                            )}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}

                            {activeTab === 'apps' && (
                                <div>
                                    <h3 className="text-lg font-semibold mb-2">
                                        Application Usage by Unique Users (Period: {filterStartDate} to {filterEndDate})
                                        {selectedApp !== 'all' ? ` | App: ${selectedApp}` : ''}
                                    </h3>
                                    <div className="overflow-x-auto">
                                        <table className="min-w-full border-collapse">
                                            <thead>
                                            <tr className="bg-gray-100">
                                                <th className="p-2 text-left border">Application</th>
                                                <th className="p-2 text-left border">Unique Users</th>
                                                <th className="p-2 text-left border">Total Sessions</th>
                                                <th className="p-2 text-left border">Sessions per User</th>
                                                <th className="p-2 text-left border">% of Total Users</th>
                                            </tr>
                                            </thead>
                                            <tbody>
                                            {filteredAppData.length > 0 ? (
                                                filteredAppData.map((app, index) => {
                                                    const sessionsPerUser = app.userCount > 0 ? (app.sessionCount / app.userCount).toFixed(1) : 'N/A';
                                                    const percentOfUsers = activeUsers > 0 ? ((app.userCount / activeUsers) * 100).toFixed(1) : '0';

                                                    return (
                                                        <tr key={index} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                                                            <td className="p-2 border">{app.name}</td>
                                                            <td className="p-2 border">{app.userCount.toLocaleString()}</td>
                                                            <td className="p-2 border">{app.sessionCount.toLocaleString()}</td>
                                                            <td className="p-2 border">{sessionsPerUser}</td>
                                                            <td className="p-2 border">
                                                                <div className="flex items-center">
                                                                    <div className="w-full bg-gray-200 rounded-full h-2.5 mr-2 max-w-32">
                                                                        <div
                                                                            className="bg-blue-600 h-2.5 rounded-full"
                                                                            style={{ width: `${percentOfUsers}%` }}
                                                                        ></div>
                                                                    </div>
                                                                    <span>{percentOfUsers}%</span>
                                                                </div>
                                                            </td>
                                                        </tr>
                                                    );
                                                })
                                            ) : (
                                                <tr>
                                                    <td colSpan="5" className="p-4 text-center text-gray-500">No application data available for selected period</td>
                                                </tr>
                                            )}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </>
            )}
        </div>
    );
};

export default SSOMetricsExplorer;
