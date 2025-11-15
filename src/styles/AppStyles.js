// Centralized React Native StyleSheet for the transit UI.

import { StyleSheet, Platform } from 'react-native';

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#0a2239'
  },
  container: {
    flex: 1,
    backgroundColor: '#0a2239'
  },
  topSearchOverlay: {
    position: 'absolute',
    top: Platform.select({ ios: 70, android: 50, default: 50 }),
    left: 16,
    right: 16,
    zIndex: 10
  },
  markerLabel: {
    backgroundColor: '#ffffff',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    borderColor: '#0a2239',
    borderWidth: StyleSheet.hairlineWidth
  },
  markerText: {
    color: '#0a2239',
    fontWeight: '700',
    fontSize: 12
  },
  stopDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#1f8b4c',
    borderWidth: 2,
    borderColor: '#0a2239'
  },
  stopDotActive: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#4ee88d'
  },
  loadingOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: 'rgba(10, 34, 57, 0.6)',
    alignItems: 'center',
    justifyContent: 'center'
  },
  loadingText: {
    marginTop: 8,
    color: '#ffffff',
    fontSize: 14
  },
  banner: {
    position: 'absolute',
    top: Platform.select({ ios: 12, android: 12 }),
    left: 16,
    right: 16,
    backgroundColor: 'rgba(255, 136, 0, 0.95)',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 12
  },
  bannerText: {
    color: '#0a2239',
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center'
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: -20,
    backgroundColor: '#08122c',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: 4,
    paddingHorizontal: 20,
    paddingBottom: 32,
    minHeight: 360,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 24,
    elevation: 30
  },
  sheetHandleArea: {
    alignItems: 'center',
    paddingVertical: 6
  },
  sheetHandle: {
    width: 48,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#2f3f66',
    alignSelf: 'center',
    marginBottom: 12
  },
  sheetTitle: {
    color: '#8aa2c8',
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 1
  },
  sheetHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center'
  },
  searchBar: {
    flex: 1,
    backgroundColor: '#0c793a',
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center'
  },
  searchInput: {
    flex: 1,
    color: '#daf6db',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8
  },
  homeButton: {
    backgroundColor: '#2de1fc',
    borderRadius: 20,
    width: 44,
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 12
  },
  homeButtonIcon: {
    marginLeft: 4
  },
  sheetWarning: {
    color: '#ffcccb',
    fontSize: 12,
    marginTop: 8
  },
  routesList: {
    paddingTop: 8,
    paddingBottom: 40,
    flexGrow: 1
  },
  stopHeader: {
    marginTop: 16,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between'
  },
  stopTitle: {
    color: '#f3f6ff',
    fontSize: 20,
    fontWeight: '700'
  },
  stopSubtitle: {
    color: '#7a8fa6',
    fontSize: 12,
    marginTop: 4
  },
  stopCloseButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#2de1fc',
    alignItems: 'center',
    justifyContent: 'center'
  },
  listHeader: {
    marginTop: 20,
    marginBottom: 12
  },
  listTitle: {
    color: '#f3f6ff',
    fontSize: 16,
    fontWeight: '700'
  },
  listSubtitle: {
    color: '#7a8fa6',
    fontSize: 12,
    marginTop: 4
  },
  routeCard: {
    backgroundColor: '#0f1f3f',
    borderRadius: 20,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 96
  },
  routeCardActive: {
    backgroundColor: '#122554',
    borderColor: '#2de1fc',
    borderWidth: 1
  },
  routeBadgeColumn: {
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16
  },
  routeBadgeText: {
    fontSize: 28,
    fontWeight: '800',
    color: '#8ed0ff'
  },
  routeBadgeTextActive: {
    color: '#ffffff'
  },
  routeBody: {
    flex: 1
  },
  routeTitle: {
    color: '#f3f6ff',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 2
  },
  routeSubtitle: {
    color: '#8aa2c8',
    fontSize: 13
  },
  routeUpdated: {
    color: '#5f7397',
    fontSize: 11,
    marginTop: 6
  },
  routeMeta: {
    alignItems: 'flex-end',
    marginLeft: 8
  },
  etaText: {
    color: '#ffffff',
    fontSize: 24,
    fontWeight: '800'
  },
  etaTextActive: {
    color: '#2de1fc'
  },
  etaCaption: {
    color: '#7a8fa6',
    fontSize: 11,
    marginBottom: 4
  },
  routeWarningIcon: {
    marginTop: 2
  },
  routeDivider: {
    height: 12
  },
  arrivalCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0f1f3f',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12
  },
  arrivalRouteBadge: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: '#0c793a',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16
  },
  arrivalRouteText: {
    color: '#daf6db',
    fontSize: 16,
    fontWeight: '800'
  },
  arrivalBody: {
    flex: 1
  },
  arrivalTitle: {
    color: '#f3f6ff',
    fontSize: 16,
    fontWeight: '600'
  },
  arrivalSubtitle: {
    color: '#7a8fa6',
    fontSize: 12,
    marginTop: 4
  },
  arrivalEtaBlock: {
    alignItems: 'flex-end',
    marginLeft: 12
  },
  arrivalEta: {
    color: '#2de1fc',
    fontSize: 24,
    fontWeight: '800'
  },
  arrivalEtaCaption: {
    color: '#7a8fa6',
    fontSize: 12,
    marginTop: 2
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 32
  },
  emptyTitle: {
    color: '#f3f6ff',
    fontSize: 16,
    fontWeight: '700'
  },
  emptySubtitle: {
    color: '#7a8fa6',
    fontSize: 13,
    textAlign: 'center',
    marginTop: 8,
    paddingHorizontal: 20
  }
});

export default styles;
