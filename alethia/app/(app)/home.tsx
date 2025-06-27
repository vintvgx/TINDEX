// import { Stack } from "expo-router";
// import React, { useEffect } from "react";
// import { SafeAreaView, StyleSheet, Text, View, ScrollView, Dimensions } from "react-native";

// import { Button, ButtonText } from "@/components/ui/button";
// import { useAuth } from "@/context/auth/AuthContext";
// import { UserType } from "@/types/user/user";
// import { useQueryClient } from "@tanstack/react-query";
// import { useProfile } from "@/hooks/queries/auth/useProfileQuery";
// import { useAssessment } from "@/hooks/queries/auth/useAssessmentQuery";
// import { ToastService } from "@/services/ToastService";

// // Add this helper function to format assessment responses
// const formatAssessmentResponse = (response: { text?: string; value?: string; values?: string[] }) => {
//   if (!response) return "Not available";
//   if (response.text) return response.text;
//   if (response.values && Array.isArray(response.values)) return response.values.join(', ');
//   if (response.value) return response.value;
//   return JSON.stringify(response); // Fallback for any other format
// };

// const { width } = Dimensions.get("window");

// const HomeScreen = () => {
//   const queryClient = useQueryClient();

//   const {
//     authState: { user },
//     signOutMutation,
//   } = useAuth();

//   const { data: profile, isLoading: profileLoading } = useProfile();
//   const { data: assessments, isLoading: assessmentsLoading} = useAssessment()


//   const handleSignOut = async () => {    
//     try {
//       await signOutMutation?.mutateAsync();
//     } catch (error) {
//       console.error('Error signing out:', error);
//       ToastService.error(`Error signing out: ${error}`)
//     }
//   };

//   useEffect(() => {
//     queryClient.invalidateQueries({
//       queryKey: ["assessments", user?.id],
//     });
//   }, []);

//   return (
//     <SafeAreaView style={styles.container}>
//       <Stack.Screen
//         options={{
//           title: "Home",
//           headerBackVisible: false,
//           headerStyle: {
//             backgroundColor: "#6C63FF",
//           },
//           headerTintColor: "#fff",
//           headerTitleStyle: {
//             fontWeight: "bold",
//           },
//         }}
//       />

//       {/* Header with solid background */}
//       <View style={styles.header}>
//         <View style={styles.userHeader}>
//           <Text style={styles.username}>
//             @{profile?.username || "Username"}
//           </Text>
//           <View style={[
//             styles.roleBadge, 
//             { backgroundColor: profile?.role === UserType.HOST ? '#FF6B6B' : '#4ECDC4' }
//           ]}>
//             <Text style={styles.roleText}>
//               {profile?.role || "Role not set"}
//             </Text>
//           </View>
//         </View>
//         <Text style={styles.welcomeText}>Welcome to VENT!</Text>
//       </View>

//       <ScrollView style={styles.contentContainer} showsVerticalScrollIndicator={false}>
//         <View style={styles.descriptionCard}>
//           <Text style={styles.descriptionText}>
//             VENT is focused on cultivating peer to peer connections based on
//             shared experiences that provide emotional, past trauma or social
//             support.
//           </Text>
//         </View>

//         {/* Account Information Section */}
//         <View style={styles.infoSection}>
//           <Text style={styles.sectionTitle}>Account Information</Text>
//           <View style={styles.infoContainer}>
//             <InfoRow label="User ID" value={user?.id} />
//             <InfoRow label="Email" value={user?.email} />
//             <InfoRow label="Phone" value={user?.phone} />
//             <InfoRow
//               label="Auth Provider"
//               value={user?.app_metadata?.provider}
//             />
//           </View>
//         </View>

//         {/* Profile Information Section */}
//         <View style={styles.infoSection}>
//           <Text style={styles.sectionTitle}>Profile Information</Text>
//           <View style={styles.infoContainer}>
//             <InfoRow label="Username" value={profile?.username} />
//             <InfoRow label="First Name" value={profile?.first_name} />
//             <InfoRow label="Last Name" value={profile?.last_name} />
//             <InfoRow label="Date of Birth" value={profile?.dob} />
//           </View>
//         </View>

//         {/* Assessment Information Section */}
//         <View style={styles.infoSection}>
//           <Text style={styles.sectionTitle}>Assessment Information</Text>
//           <View style={styles.infoContainer}>
//             {assessments && assessments.length > 0 ? (
//               assessments.map((assessment, index) => (
//                 <View key={assessment.id} style={styles.assessmentItem}>
//                   <Text style={styles.assessmentTitle}>
//                     Assessment {index + 1}: {assessment.question_id}
//                   </Text>
//                   <InfoRow
//                     label="Response"
//                     value={formatAssessmentResponse(assessment.response)}
//                   />
//                   <InfoRow
//                     label="Version"
//                     value={assessment.assessment_version?.toString()}
//                   />
//                   <InfoRow
//                     label="Last Updated"
//                     value={new Date(assessment.updated_at).toLocaleDateString()}
//                   />
//                   {index < assessments.length - 1 && (
//                     <View style={styles.assessmentDivider} />
//                   )}
//                 </View>
//               ))
//             ) : (
//               <Text style={styles.noDataText}>
//                 No assessment data available
//               </Text>
//             )}
//           </View>
//         </View>

//         <View style={styles.buttonContainer}>
//           <Button 
//             action="negative" 
//             onPress={handleSignOut}
//             style={styles.signOutButton}
//           >
//             <ButtonText style={styles.signOutText}>Sign Out</ButtonText>
//           </Button>
//         </View>
//       </ScrollView>
//     </SafeAreaView>
//   );
// };

// // Helper component for consistent info row display
// const InfoRow = ({
//   label,
//   value,
// }: {
//   label: string;
//   value?: string | null;
// }) => (
//   <View style={styles.infoRow}>
//     <Text style={styles.infoLabel}>{label}:</Text>
//     <Text style={styles.infoValue}>{value || "Not available"}</Text>
//   </View>
// );

// export default HomeScreen;

// const styles = StyleSheet.create({
//   container: {
//     flex: 1,
//     backgroundColor: "#f8f9fa",
//   },
//   header: {
//     backgroundColor: "#6C63FF",
//     paddingHorizontal: 24,
//     paddingTop: 20,
//     paddingBottom: 30,
//     borderBottomLeftRadius: 30,
//     borderBottomRightRadius: 30,
//   },
//   contentContainer: {
//     flex: 1,
//     paddingHorizontal: 24,
//     marginTop: 30
//   },
//   userHeader: {
//     flexDirection: "row",
//     alignItems: "center",
//     justifyContent: "space-between",
//     paddingVertical: 12,
//   },
//   username: {
//     fontSize: 24,
//     fontWeight: "700",
//     color: "#fff",
//   },
//   welcomeText: {
//     fontSize: 32,
//     fontWeight: "bold",
//     marginBottom: 8,
//     color: "#fff",
//   },
//   descriptionCard: {
//     backgroundColor: "#fff",
//     borderRadius: 16,
//     padding: 20,
//     marginTop: 0,
//     marginBottom: 24,
//     shadowColor: "#000",
//     shadowOffset: { width: 0, height: 2 },
//     shadowOpacity: 0.1,
//     shadowRadius: 8,
//     elevation: 4,
//   },
//   descriptionText: {
//     fontSize: 16,
//     color: "#495057",
//     lineHeight: 24,
//   },
//   infoSection: {
//     marginBottom: 24,
//   },
//   sectionTitle: {
//     fontSize: 20,
//     fontWeight: "600",
//     marginBottom: 12,
//     color: "#343a40",
//     paddingLeft: 8,
//   },
//   infoContainer: {
//     backgroundColor: "#fff",
//     borderRadius: 16,
//     padding: 16,
//     shadowColor: "#000",
//     shadowOffset: { width: 0, height: 1 },
//     shadowOpacity: 0.05,
//     shadowRadius: 5,
//     elevation: 2,
//   },
//   infoRow: {
//     flexDirection: "row",
//     marginBottom: 12,
//     flexWrap: "wrap",
//   },
//   infoLabel: {
//     fontSize: 16,
//     fontWeight: "500",
//     width: 140,
//     color: "#6C63FF",
//   },
//   infoValue: {
//     flex: 1,
//     fontSize: 16,
//     color: "#495057",
//   },
//   buttonContainer: {
//     marginVertical: 24,
//     alignItems: "center",
//   },
//   roleBadge: {
//     paddingHorizontal: 16,
//     paddingVertical: 8,
//     borderRadius: 20,
//   },
//   roleText: {
//     color: "#FFF",
//     fontSize: 14,
//     fontWeight: "600",
//     textTransform: "capitalize",
//   },
//   noDataText: {
//     fontSize: 16,
//     color: "#6c757d",
//     fontStyle: "italic",
//     textAlign: "center",
//     padding: 12,
//   },
//   assessmentItem: {
//     marginBottom: 16,
//   },
//   assessmentTitle: {
//     fontSize: 18,
//     fontWeight: "600",
//     marginBottom: 8,
//     color: "#6C63FF",
//   },
//   assessmentDivider: {
//     height: 1,
//     backgroundColor: "#e9ecef",
//     marginVertical: 12,
//   },
//   signOutButton: {
//     width: width * 0.8,
//     borderRadius: 12,
//   },
//   signOutText: {
//     fontWeight: "600",
//   }
// });